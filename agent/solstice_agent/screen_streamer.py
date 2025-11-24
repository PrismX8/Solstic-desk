from __future__ import annotations

import asyncio
import base64
import io
import time
from typing import AsyncGenerator, Dict, Any

import mss
from PIL import Image


class ScreenStreamer:
  def __init__(self, fps: int, quality: int, max_width: int):
    self.fps = max(1, fps)
    self.quality = max(10, min(95, quality))
    self.max_width = max_width
    self._sct = mss.mss()
    self._monitor = self._sct.monitors[0]

  async def frames(self) -> AsyncGenerator[Dict[str, Any], None]:
    while True:
      start = time.perf_counter()
      raw = self._sct.grab(self._monitor)
      img = Image.frombytes('RGB', raw.size, raw.rgb)

      if self.max_width and img.width > self.max_width:
        ratio = self.max_width / img.width
        new_size = (self.max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

      buffer = io.BytesIO()
      img.save(buffer, format='JPEG', optimize=True, quality=self.quality)
      encoded = base64.b64encode(buffer.getvalue()).decode('ascii')

      yield {
        'data': encoded,
        'mime': 'image/jpeg',
        'width': img.width,
        'height': img.height,
        'bytes': buffer.tell(),
        'timestamp': int(time.time() * 1000),
      }

      elapsed = time.perf_counter() - start
      await asyncio.sleep(max(0, 1 / self.fps - elapsed))

