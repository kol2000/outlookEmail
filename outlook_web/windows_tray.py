#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Windows tray integration for the packaged desktop app."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from typing import Callable


WM_DESTROY = 0x0002
WM_COMMAND = 0x0111
WM_USER = 0x0400
WM_LBUTTONUP = 0x0202
WM_RBUTTONUP = 0x0205
WM_CLOSE = 0x0010

NIF_MESSAGE = 0x0001
NIF_ICON = 0x0002
NIF_TIP = 0x0004
NIM_ADD = 0x00000000
NIM_MODIFY = 0x00000001
NIM_DELETE = 0x00000002

TPM_LEFTALIGN = 0x0000
TPM_RIGHTBUTTON = 0x0002
TPM_BOTTOMALIGN = 0x0020

IDI_APPLICATION = 32512
IDC_ARROW = 32512
COLOR_WINDOW = 5

TRAY_CALLBACK = WM_USER + 20
MENU_OPEN = 1001
MENU_EXIT = 1002

user32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
kernel32 = ctypes.windll.kernel32


LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT,
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
)


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
    ]


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HCURSOR),
        ("hbrBackground", ctypes.c_void_p),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", wintypes.HWND),
        ("uID", wintypes.UINT),
        ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT),
        ("hIcon", wintypes.HICON),
        ("szTip", wintypes.WCHAR * 128),
        ("dwState", wintypes.DWORD),
        ("dwStateMask", wintypes.DWORD),
        ("szInfo", wintypes.WCHAR * 256),
        ("uTimeoutOrVersion", wintypes.UINT),
        ("szInfoTitle", wintypes.WCHAR * 64),
        ("dwInfoFlags", wintypes.DWORD),
        ("guidItem", ctypes.c_byte * 16),
        ("hBalloonIcon", wintypes.HICON),
    ]


class WindowsTrayApp:
    """Minimal Windows tray app backed by Win32 APIs only."""

    def __init__(self, tooltip: str, on_open: Callable[[], None], on_exit: Callable[[], None]):
        self.tooltip = tooltip[:127]
        self.on_open = on_open
        self.on_exit = on_exit
        self._class_name = "OutlookEmailTrayWindow"
        self._instance = kernel32.GetModuleHandleW(None)
        self._hwnd = None
        self._menu = None
        self._nid = None
        self._wndproc = WNDPROC(self._window_proc)

    def run(self) -> None:
        self._register_window_class()
        self._create_window()
        self._create_menu()
        self._install_icon()
        self._message_loop()

    def close(self) -> None:
        if self._hwnd:
            user32.PostMessageW(self._hwnd, WM_CLOSE, 0, 0)

    def _register_window_class(self) -> None:
        window_class = WNDCLASSW()
        window_class.lpfnWndProc = self._wndproc
        window_class.hInstance = self._instance
        window_class.lpszClassName = self._class_name
        window_class.hIcon = user32.LoadIconW(None, IDI_APPLICATION)
        window_class.hCursor = user32.LoadCursorW(None, IDC_ARROW)
        window_class.hbrBackground = ctypes.c_void_p(COLOR_WINDOW + 1)
        user32.RegisterClassW(ctypes.byref(window_class))

    def _create_window(self) -> None:
        self._hwnd = user32.CreateWindowExW(
            0,
            self._class_name,
            self.tooltip,
            0,
            0,
            0,
            0,
            0,
            None,
            None,
            self._instance,
            None,
        )

    def _create_menu(self) -> None:
        self._menu = user32.CreatePopupMenu()
        user32.AppendMenuW(self._menu, 0, MENU_OPEN, "打开界面")
        user32.AppendMenuW(self._menu, 0, MENU_EXIT, "退出")

    def _install_icon(self) -> None:
        icon = user32.LoadIconW(None, IDI_APPLICATION)
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self._hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = TRAY_CALLBACK
        nid.hIcon = icon
        nid.szTip = self.tooltip
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
        self._nid = nid

    def _remove_icon(self) -> None:
        if self._nid is not None:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid))
            self._nid = None

    def _show_menu(self) -> None:
        point = POINT()
        user32.GetCursorPos(ctypes.byref(point))
        user32.SetForegroundWindow(self._hwnd)
        user32.TrackPopupMenu(
            self._menu,
            TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON,
            point.x,
            point.y,
            0,
            self._hwnd,
            None,
        )

    def _message_loop(self) -> None:
        msg = MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def _window_proc(self, hwnd, msg, wparam, lparam):
        if msg == TRAY_CALLBACK:
            if lparam == WM_LBUTTONUP:
                self.on_open()
                return 0
            if lparam == WM_RBUTTONUP:
                self._show_menu()
                return 0

        if msg == WM_COMMAND:
            command = wparam & 0xFFFF
            if command == MENU_OPEN:
                self.on_open()
                return 0
            if command == MENU_EXIT:
                self.on_exit()
                self.close()
                return 0

        if msg in (WM_CLOSE, WM_DESTROY):
            self._remove_icon()
            user32.PostQuitMessage(0)
            return 0

        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)
