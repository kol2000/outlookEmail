#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compatibility entrypoint for the segmented Outlook web app."""

import os
from pathlib import Path


SEGMENT_FILES = (
    "01_bootstrap.py",
    "02_groups_accounts.py",
    "03_mail_helpers.py",
    "04_routes_groups_accounts.py",
    "05_routes_refresh_mail.py",
    "06_routes_temp_email.py",
    "07_routes_oauth_settings_external.py",
    "08_forwarding_scheduler_errors.py",
)

SEGMENTS_DIR = Path(__file__).resolve().parent / "outlook_web" / "segments"


def _load_segmented_app():
    if globals().get("_SEGMENTED_APP_LOADED"):
        return

    globals()["_SEGMENTED_APP_LOADED"] = True
    for segment_name in SEGMENT_FILES:
        segment_path = SEGMENTS_DIR / segment_name
        code = compile(segment_path.read_text(encoding="utf-8"), str(segment_path), "exec")
        exec(code, globals())


_load_segmented_app()


def main():
    port = int(os.getenv("PORT", 5000))
    host = os.getenv("HOST", "0.0.0.0")
    debug = os.getenv("FLASK_ENV", "production") != "production"

    print("=" * 60)
    print("Outlook 邮件 Web 应用")
    print("=" * 60)
    print(f"访问地址: http://{host}:{port}")
    print(f"运行模式: {'开发' if debug else '生产'}")
    print("=" * 60)

    init_scheduler()
    app.run(debug=debug, host=host, port=port)


if __name__ == "__main__":
    main()
