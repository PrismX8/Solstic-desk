from rich.console import Console
from rich.panel import Panel

console = Console()


def banner(message: str) -> None:
  console.print(
    Panel.fit(
      message,
      border_style='cyan',
      padding=(1, 2),
    ),
  )

