from __future__ import annotations

import pyautogui

pyautogui.FAILSAFE = False


def apply_input(event: dict) -> None:
  kind = event.get('kind')

  if kind == 'mouse_move':
    width, height = pyautogui.size()
    x = int(event.get('x', 0) * width)
    y = int(event.get('y', 0) * height)
    pyautogui.moveTo(x, y, duration=0)

  elif kind == 'mouse_down':
    pyautogui.mouseDown(button=event.get('button', 'left'))

  elif kind == 'mouse_up':
    pyautogui.mouseUp(button=event.get('button', 'left'))

  elif kind == 'mouse_wheel':
    pyautogui.scroll(int(event.get('deltaY', 0)))
    if event.get('deltaX'):
      pyautogui.hscroll(int(event['deltaX']))

  elif kind == 'key_down':
    key = _normalize_key(event.get('key'))
    if key:
      pyautogui.keyDown(key)

  elif kind == 'key_up':
    key = _normalize_key(event.get('key'))
    if key:
      pyautogui.keyUp(key)

  elif kind == 'text':
    text = event.get('text')
    if text:
      pyautogui.typewrite(text)


def _normalize_key(key: str | None) -> str | None:
  if not key:
    return None
  table = {
    'meta': 'win',
    'control': 'ctrl',
    ' ': 'space',
  }
  return table.get(key.lower(), key.lower())

