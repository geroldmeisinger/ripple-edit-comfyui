"""
ComfyUI Ripple Edit
--------------------
Frontend-only extension. No custom nodes are registered - this package only
ships a JavaScript extension (see ./js/ripple_edit.js) that is auto-loaded
by the ComfyUI web client.
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
