from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=ROOT_DIR / '.env', override=False)


@dataclass
class AgentConfig:
  server_url: str
  device_name: str
  region: str
  fps: int
  jpeg_quality: int
  max_width: int
  save_dir: Path


def load_config() -> AgentConfig:
  return AgentConfig(
    server_url=os.getenv('AGENT_SERVER_URL', 'ws://localhost:8080/ws'),
    device_name=os.getenv('AGENT_DEVICE_NAME', 'Solstice Agent'),
    region=os.getenv('AGENT_REGION', 'local'),
    fps=int(os.getenv('AGENT_FPS', '8')),
    jpeg_quality=int(os.getenv('AGENT_JPEG_QUALITY', '65')),
    max_width=int(os.getenv('AGENT_MAX_WIDTH', '1280')),
    save_dir=Path(os.getenv('AGENT_SAVE_DIR', ROOT_DIR / 'downloads')).expanduser(),
  )

