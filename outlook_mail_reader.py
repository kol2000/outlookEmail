#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Outlook 邮件读取测试工具
使用三种方式读取 Outlook 邮箱邮件：
1. 旧版 IMAP 方式 (outlook_imap_old_utils)
2. 新版 IMAP 方式 (outlook_imap_new_utils)
3. Graph API 方式 (graph_utils)
"""

from outlook_web.i18n import translate as _tr

import email
import imaplib
from email.header import decode_header
from typing import Optional, List, Dict, Any

import requests

# ==================== 配置参数 ====================
# 邮箱账号
EMAIL = ""
# 邮箱密码（通常不需要，OAuth2 认证时使用 refresh_token）
PASSWORD = ""
# OAuth2 refresh_token
CLIENT_ID = ""
# OAuth2 client_id
REFRESH_TOKEN= ""
# 代理地址（可选，格式: host:port 或 http://host:port）
PROXY = None  # 例如: "127.0.0.1:7890"
# ================================================


# Token 端点
TOKEN_URL_LIVE = "https://login.live.com/oauth20_token.srf"
TOKEN_URL_GRAPH = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
TOKEN_URL_IMAP = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

# IMAP 服务器配置
IMAP_SERVER_OLD = "outlook.office365.com"
IMAP_SERVER_NEW = "outlook.live.com"
IMAP_PORT = 993
IMAP_TIMEOUT = int(os.getenv("IMAP_TIMEOUT", "45"))


def print_separator(title: str):
    """打印分隔线"""
    print("\n" + "=" * 80)
    print(f"【{title}】")
    print("=" * 80)


def decode_header_value(header_value: str) -> str:
    """解码邮件头字段"""
    if not header_value:
        return ""
    try:
        decoded_parts = decode_header(str(header_value))
        decoded_string = ""
        for part, charset in decoded_parts:
            if isinstance(part, bytes):
                try:
                    decoded_string += part.decode(charset if charset else 'utf-8', 'replace')
                except (LookupError, UnicodeDecodeError):
                    decoded_string += part.decode('utf-8', 'replace')
            else:
                decoded_string += str(part)
        return decoded_string
    except Exception:
        return str(header_value) if header_value else ""


def print_email_info(emails: List[Any], method_name: str):
    """打印邮件信息"""
    if not emails:
        print(_tr('❌ {__0__}: 未获取到邮件', f'{method_name}'))
        return

    print(_tr('✅ {__0__}: 成功获取 {__1__} 封邮件\n', f'{method_name}', f'{len(emails)}'))

    for i, msg in enumerate(emails[:5]):  # 只显示前5封
        print(_tr('  📧 邮件 {__0__}:', f'{i + 1}'))

        # 根据邮件类型获取信息
        if isinstance(msg, dict):
            # Graph API 返回的是字典
            subject = msg.get("subject", _tr('无主题'))
            from_info = msg.get("from", {})
            sender = from_info.get("emailAddress", {}).get("address", _tr('未知发件人'))
            received_time = msg.get("receivedDateTime", _tr('未知时间'))
            print(_tr('     主题: {__0__}', f'{subject}'))
            print(_tr('     发件人: {__0__}', f'{sender}'))
            print(_tr('     时间: {__0__}', f'{received_time}'))
        else:
            # IMAP 返回的是 email.message.EmailMessage
            subject = decode_header_value(msg.get("Subject", _tr('无主题')))
            sender = decode_header_value(msg.get("From", _tr('未知发件人')))
            date = msg.get("Date", _tr('未知时间'))
            print(_tr('     主题: {__0__}', f'{subject}'))
            print(_tr('     发件人: {__0__}', f'{sender}'))
            print(_tr('     时间: {__0__}', f'{date}'))
        print()


# ==================== 方式1: 旧版 IMAP 方式 ====================

def get_access_token_old(account: str, client_id: str, refresh_token: str) -> Optional[str]:
    """
    旧版方式获取 access_token
    使用 login.live.com 端点
    """
    print(_tr('  🔑 正在获取 access_token (旧版 login.live.com)...'))

    try:
        data = {
            'client_id': client_id,
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token
        }

        ret = requests.post(TOKEN_URL_LIVE, data=data, timeout=30)

        if ret.status_code != 200:
            print(_tr('  ❌ 获取 access_token 失败: {__0__}', f'{ret.status_code}'))
            print(_tr('     响应: {__0__}...', f'{ret.text[:200]}'))
            if "User account is found to be in service abuse mode" in ret.text:
                print(_tr('  ⚠️ 账号被封禁!'))
            return None

        access_token = ret.json().get('access_token')
        if access_token:
            print(_tr('  ✅ 成功获取 access_token，长度: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ 获取 access_token 异常: {__0__}', f'{e}'))
        return None


def read_emails_imap_old(account: str, client_id: str, refresh_token: str, top: int = 10) -> Optional[List]:
    """
    方式1: 旧版 IMAP 方式读取邮件
    使用 outlook.office365.com 服务器
    """
    print_separator(_tr('方式1: 旧版 IMAP 方式 (outlook.office365.com)'))

    # 1. 获取 access_token
    access_token = get_access_token_old(account, client_id, refresh_token)
    if not access_token:
        return None

    # 2. 连接 IMAP 服务器
    connection = None
    try:
        print(_tr('  📡 正在连接 IMAP 服务器: {__0__}...', f'{IMAP_SERVER_OLD}'))
        connection = imaplib.IMAP4_SSL(IMAP_SERVER_OLD, IMAP_PORT, timeout=IMAP_TIMEOUT)

        # 3. XOAUTH2 认证
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1"
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        print(_tr('  ✅ IMAP 认证成功'))

        # 4. 选择收件箱
        connection.select("INBOX")

        # 5. 搜索邮件
        status, messages = connection.search(None, 'ALL')
        if status != 'OK' or not messages or not messages[0]:
            print(_tr('  ⚠️ 收件箱为空'))
            return []

        message_ids = messages[0].split()
        print(_tr('  📬 收件箱共有 {__0__} 封邮件', f'{len(message_ids)}'))

        # 6. 获取最近的邮件
        recent_ids = message_ids[-top:][::-1]  # 倒序，最新的在前

        emails = []
        for msg_id in recent_ids:
            try:
                status, msg_data = connection.fetch(msg_id, '(RFC822)')
                if status == 'OK' and msg_data and msg_data[0]:
                    raw_email = msg_data[0][1]
                    msg = email.message_from_bytes(raw_email)
                    emails.append(msg)
            except Exception as e:
                print(_tr('  ⚠️ 解析邮件 {__0__} 失败: {__1__}', f'{msg_id}', f'{e}'))
                continue

        return emails

    except Exception as e:
        print(_tr('  ❌ IMAP 连接失败: {__0__}', f'{e}'))
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


# ==================== 方式2: 新版 IMAP 方式 ====================

def get_access_token_imap(client_id: str, refresh_token: str) -> Optional[str]:
    """
    新版方式获取 IMAP access_token
    使用 login.microsoftonline.com/consumers 端点，IMAP scope
    """
    print(_tr('  🔑 正在获取 access_token (新版 IMAP scope)...'))

    try:
        proxies = None
        if PROXY:
            proxies = {"all": f"http://{PROXY}" if not PROXY.startswith("http") else PROXY}

        res = requests.post(
            TOKEN_URL_IMAP,
            data={
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
            },
            proxies=proxies,
            timeout=30
        )

        if res.status_code != 200:
            print(_tr('  ❌ 获取 access_token 失败: {__0__}', f'{res.status_code}'))
            print(_tr('     响应: {__0__}...', f'{res.text[:200]}'))
            if "User account is found to be in service abuse mode" in res.text:
                print(_tr('  ⚠️ 账号被封禁!'))
            return None

        access_token = res.json().get("access_token")
        if access_token:
            print(_tr('  ✅ 成功获取 access_token，长度: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ 获取 access_token 异常: {__0__}', f'{e}'))
        return None


def read_emails_imap_new(account: str, client_id: str, refresh_token: str, top: int = 10) -> Optional[List]:
    """
    方式2: 新版 IMAP 方式读取邮件
    使用 outlook.live.com 服务器
    """
    print_separator(_tr('方式2: 新版 IMAP 方式 (outlook.live.com)'))

    # 1. 获取 access_token
    access_token = get_access_token_imap(client_id, refresh_token)
    if not access_token:
        return None

    # 2. 连接 IMAP 服务器
    connection = None
    try:
        print(_tr('  📡 正在连接 IMAP 服务器: {__0__}...', f'{IMAP_SERVER_NEW}'))
        connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT, timeout=IMAP_TIMEOUT)

        # 3. XOAUTH2 认证
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        print(_tr('  ✅ IMAP 认证成功'))

        # 4. 选择收件箱
        connection.select('"INBOX"')

        # 5. 搜索邮件
        status, messages = connection.search(None, 'ALL')
        if status != 'OK' or not messages or not messages[0]:
            print(_tr('  ⚠️ 收件箱为空'))
            return []

        message_ids = messages[0].split()
        print(_tr('  📬 收件箱共有 {__0__} 封邮件', f'{len(message_ids)}'))

        # 6. 获取最近的邮件
        recent_ids = message_ids[-top:][::-1]

        emails = []
        for msg_id in recent_ids:
            try:
                status, msg_data = connection.fetch(msg_id, '(RFC822)')
                if status == 'OK' and msg_data and msg_data[0]:
                    raw_email = msg_data[0][1]
                    msg = email.message_from_bytes(raw_email)
                    emails.append(msg)
            except Exception as e:
                print(_tr('  ⚠️ 解析邮件 {__0__} 失败: {__1__}', f'{msg_id}', f'{e}'))
                continue

        return emails

    except Exception as e:
        print(_tr('  ❌ IMAP 连接失败: {__0__}', f'{e}'))
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


# ==================== 方式3: Graph API 方式 ====================

def get_access_token_graph(client_id: str, refresh_token: str) -> Optional[str]:
    """
    Graph API 方式获取 access_token
    使用 login.microsoftonline.com/common 端点，Graph scope
    """
    print(_tr('  🔑 正在获取 access_token (Graph API)...'))

    try:
        proxies = None
        if PROXY:
            proxies = {"all": f"http://{PROXY}" if not PROXY.startswith("http") else PROXY}

        res = requests.post(
            TOKEN_URL_GRAPH,
            data={
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": "https://graph.microsoft.com/.default"
            },
            proxies=proxies,
            timeout=30
        )

        if res.status_code != 200:
            print(_tr('  ❌ 获取 access_token 失败: {__0__}', f'{res.status_code}'))
            print(_tr('     响应: {__0__}...', f'{res.text[:200]}'))
            if "User account is found to be in service abuse mode" in res.text:
                print(_tr('  ⚠️ 账号被封禁!'))
            return None

        access_token = res.json().get("access_token")
        if access_token:
            print(_tr('  ✅ 成功获取 access_token，长度: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ 获取 access_token 异常: {__0__}', f'{e}'))
        return None


def read_emails_graph(client_id: str, refresh_token: str, top: int = 10) -> Optional[List[Dict]]:
    """
    方式3: Graph API 方式读取邮件
    使用 Microsoft Graph API
    """
    print_separator(_tr('方式3: Graph API 方式'))

    # 1. 获取 access_token
    access_token = get_access_token_graph(client_id, refresh_token)
    if not access_token:
        return None

    # 2. 调用 Graph API 获取邮件
    try:
        proxies = None
        if PROXY:
            proxies = {"http": f"http://{PROXY}", "https": f"http://{PROXY}"}

        print(_tr('  📡 正在调用 Graph API...'))

        url = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
        params = {
            "$top": top,
            "$select": "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview",
            "$orderby": "receivedDateTime desc",
            "$count": "true"
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='text'"
        }

        res = requests.get(url, headers=headers, params=params, proxies=proxies, timeout=30)

        if res.status_code != 200:
            print(_tr('  ❌ Graph API 调用失败: {__0__}', f'{res.status_code}'))
            print(_tr('     响应: {__0__}...', f'{res.text[:200]}'))
            return None

        data = res.json()
        messages = data.get("value", [])
        total = data.get("@odata.count", len(messages))
        print(_tr('  📬 收件箱共有 {__0__} 封邮件', f'{total}'))

        return messages

    except Exception as e:
        print(_tr('  ❌ Graph API 调用异常: {__0__}', f'{e}'))
        return None


# ==================== 主函数 ====================

def main():
    """主函数：使用三种方式读取邮件"""
    print("\n" + _tr('🚀 Outlook 邮件读取测试工具'))
    print("=" * 80)
    print(_tr('邮箱: {__0__}', f'{EMAIL}'))
    print(f"Client ID: {CLIENT_ID}")
    print(f"Refresh Token: {REFRESH_TOKEN[:30]}..." if REFRESH_TOKEN else _tr('未设置'))
    print(_tr('代理: {__0__}', f"{(PROXY if PROXY else '无')}"))
    print("=" * 80)

    # 检查配置
    if EMAIL == "" or REFRESH_TOKEN == "":
        print(_tr('\n⚠️ 请先配置邮箱信息！'))
        print(_tr('   修改脚本顶部的 EMAIL, REFRESH_TOKEN, CLIENT_ID 变量'))
        return

    results = {}

    # 方式1: 旧版 IMAP
    try:
        emails_old = read_emails_imap_old(EMAIL, CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_old, _tr('旧版 IMAP'))
        results[_tr('旧版 IMAP')] = _tr('✅ 成功') if emails_old else _tr('❌ 失败')
    except Exception as e:
        print(_tr('❌ 旧版 IMAP 异常: {__0__}', f'{e}'))
        results[_tr('旧版 IMAP')] = _tr('❌ 异常: {__0__}', f'{e}')

    # 方式2: 新版 IMAP
    try:
        emails_new = read_emails_imap_new(EMAIL, CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_new, _tr('新版 IMAP'))
        results[_tr('新版 IMAP')] = _tr('✅ 成功') if emails_new else _tr('❌ 失败')
    except Exception as e:
        print(_tr('❌ 新版 IMAP 异常: {__0__}', f'{e}'))
        results[_tr('新版 IMAP')] = _tr('❌ 异常: {__0__}', f'{e}')

    # 方式3: Graph API
    try:
        emails_graph = read_emails_graph(CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_graph, "Graph API")
        results["Graph API"] = _tr('✅ 成功') if emails_graph else _tr('❌ 失败')
    except Exception as e:
        print(_tr('❌ Graph API 异常: {__0__}', f'{e}'))
        results["Graph API"] = _tr('❌ 异常: {__0__}', f'{e}')

    # 打印汇总
    print_separator(_tr('测试结果汇总'))
    for method, result in results.items():
        print(f"  {method}: {result}")

    print("\n" + "=" * 80)
    print(_tr('测试完成!'))
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
