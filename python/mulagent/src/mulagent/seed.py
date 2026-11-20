"""Deterministic seeding helper."""

from __future__ import annotations

import os
import random


def seed_everything(seed: int, *, deterministic: bool = False) -> int:
    """Seed Python stdlib, NumPy, and PyTorch (when installed) deterministically."""
    seed = int(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)

    try:
        import numpy as np  # type: ignore[import-not-found]

        np.random.seed(seed)
    except ImportError:
        pass

    try:
        import torch  # type: ignore[import-not-found]

        torch.manual_seed(seed)
        if hasattr(torch, "cuda") and torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        if deterministic and hasattr(torch, "backends") and hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False
    except ImportError:
        pass

    return seed
