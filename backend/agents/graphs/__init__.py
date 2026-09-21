"""难度子图：simple / medium（ReAct）/ hard（plan→verify）。"""

from .hard import HARD_SYSTEM, build_hard_graph, run_hard
from .medium import MEDIUM_SYSTEM, build_medium_graph, build_react_graph, run_medium
from .pipeline import build_pipeline, run_pipeline
from .simple import build_simple_graph, run_simple

__all__ = [
    "HARD_SYSTEM",
    "MEDIUM_SYSTEM",
    "build_hard_graph",
    "build_medium_graph",
    "build_pipeline",
    "build_react_graph",
    "build_simple_graph",
    "run_hard",
    "run_medium",
    "run_pipeline",
    "run_simple",
]
