from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
import platform

import websockets
from websockets import WebSocketClientProtocol

from solstice_agent.config import load_config
from solstice_agent.control import apply_input
from solstice_agent.file_bridge import FileBridge
from solstice_agent.logging import banner, console
from solstice_agent.screen_streamer import ScreenStreamer


@dataclass
class AgentState:
  session_code: str | None = None
  viewers: int = 0

  def __post_init__(self):
    self.streaming = asyncio.Event()


async def main() -> None:
  config = load_config()
  banner('[bold cyan]Solstice Desk Agent')
  console.print(f'[cyan]Relay: {config.server_url}')
  bridge = FileBridge(config.save_dir)
  streamer = ScreenStreamer(config.fps, config.jpeg_quality, config.max_width)

  while True:
    state = AgentState()
    try:
      async with websockets.connect(
        config.server_url,
        max_size=8 * 1024 * 1024,
        ping_interval=15,
      ) as ws:
        console.print('[green]Connected to relay. Registering agent…')
        await send(
          ws,
          'announce_agent',
          {
            'deviceName': config.device_name,
            'os': _platform_name(),
            'region': config.region,
            'capabilities': ['control', 'files', 'chat'],
          },
        )

        receiver_task = asyncio.create_task(
          receiver_loop(ws, state, bridge),
        )
        stream_task = asyncio.create_task(stream_loop(ws, state, streamer))
        heartbeat_task = asyncio.create_task(heartbeat_loop(ws, config.fps))

        done, pending = await asyncio.wait(
          {receiver_task, stream_task, heartbeat_task},
          return_when=asyncio.FIRST_EXCEPTION,
        )
        for task in pending:
          task.cancel()
        for task in done:
          task.result()
    except (OSError, websockets.WebSocketException) as error:
      console.print(f'[red]Connection lost: {error}. Reconnecting in 3s…')
      await asyncio.sleep(3)


async def receiver_loop(
  ws: WebSocketClientProtocol,
  state: AgentState,
  bridge: FileBridge,
) -> None:
  async for message in ws:
    data = json.loads(message)
    msg_type = data.get('type')
    payload = data.get('payload', {})

    if msg_type == 'session_ready':
      state.session_code = payload.get('code')
      console.print(
        f"[bold]Session code: [cyan]{state.session_code}[/] (expires {payload.get('expiresAt')})",
      )
    elif msg_type == 'viewer_joined':
      state.viewers = payload.get('totalViewers', 1)
      state.streaming.set()
      console.print(f"[green]Viewer joined ({state.viewers} online).")
    elif msg_type == 'viewer_left':
      state.viewers = payload.get('totalViewers', 0)
      if state.viewers <= 0:
        state.streaming.clear()
      console.print(f"[yellow]Viewer left. {state.viewers} remaining.")
    elif msg_type == 'input_event':
      apply_input(payload)
    elif msg_type == 'chat_message':
      console.print(
        f"[magenta]{payload.get('nickname')}: {payload.get('message')}",
      )
    elif msg_type == 'file_offer' and payload.get('direction') == 'viewer_to_agent':
      bridge.create_offer(
        payload['fileId'],
        payload['name'],
        payload.get('size', 0),
        payload.get('mime'),
        payload.get('total', 0) or 1,
      )
      console.print(f"[cyan]Incoming file: {payload.get('name')}")
    elif msg_type == 'file_chunk' and payload.get('sender') == 'viewer':
      path = bridge.push_chunk(
        payload['fileId'],
        payload['index'],
        payload['data'],
        payload['total'],
        payload.get('mime'),
      )
      progress = (payload['index'] + 1) / payload['total']
      console.print(f"[blue]File transfer {progress:.0%}")
      if path:
        console.print(f"[green]File saved to {path}")


async def stream_loop(
  ws: WebSocketClientProtocol,
  state: AgentState,
  streamer: ScreenStreamer,
) -> None:
  frame_gen = streamer.frames()
  async for frame in frame_gen:
    await state.streaming.wait()
    await send(ws, 'frame', frame)


async def heartbeat_loop(ws: WebSocketClientProtocol, fps: int) -> None:
  while True:
    await asyncio.sleep(10)
    await send(ws, 'heartbeat', {'fps': fps})


async def send(
  ws: WebSocketClientProtocol, msg_type: str, payload: dict,
) -> None:
  await ws.send(json.dumps({'type': msg_type, 'payload': payload}))


def _platform_name() -> str:
  return platform.platform()


if __name__ == '__main__':
  try:
    asyncio.run(main())
  except KeyboardInterrupt:
    console.print('\n[red]Agent stopped')

