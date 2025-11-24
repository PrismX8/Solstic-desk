from __future__ import annotations

import base64
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class FileBuffer:
  name: str
  mime: str | None
  size: int
  total: int
  chunks: List[Optional[str]] = field(default_factory=list)


class FileBridge:
  def __init__(self, directory: Path):
    self.directory = directory
    self.directory.mkdir(parents=True, exist_ok=True)
    self.buffers: Dict[str, FileBuffer] = {}

  def create_offer(
    self, file_id: str, name: str, size: int, mime: str | None, total_chunks: int
  ) -> None:
    self.buffers[file_id] = FileBuffer(
      name=name,
      mime=mime,
      size=size,
      total=total_chunks,
      chunks=[None] * total_chunks,
    )

  def push_chunk(
    self,
    file_id: str,
    index: int,
    data: str,
    total: int,
    mime: str | None = None,
  ) -> Path | None:
    buffer = self.buffers.get(file_id)
    if not buffer:
      self.create_offer(
        file_id=file_id,
        name=f'inbound-{file_id}',
        size=0,
        mime=mime,
        total_chunks=total,
      )
      buffer = self.buffers[file_id]

    buffer.total = total
    if 0 <= index < total:
      buffer.chunks[index] = data

    if all(chunk is not None for chunk in buffer.chunks[: total]):
      return self._flush(file_id)
    return None

  def _flush(self, file_id: str) -> Path:
    buffer = self.buffers[file_id]
    payload = ''.join(chunk or '' for chunk in buffer.chunks)
    binary = base64.b64decode(payload.encode('ascii'))
    path = self.directory / buffer.name
    path.write_bytes(binary)
    del self.buffers[file_id]
    return path

