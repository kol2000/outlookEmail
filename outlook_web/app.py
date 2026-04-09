import importlib


_module = importlib.import_module("web_outlook_app")

for _name in dir(_module):
    if _name.startswith("_"):
        continue
    globals()[_name] = getattr(_module, _name)

__all__ = [name for name in globals() if not name.startswith("_")]
