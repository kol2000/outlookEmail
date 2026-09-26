#!/usr/bin/env python3
# -*- coding: utf-8 -*-
'\nOutlook mail reading test tool\nUse three methods to read Outlook mailbox messages:\n1. Old version of IMAP method (outlook_imap_old_utils)\n2. New version of IMAP method (outlook_imap_new_utils)\n3. Graph API method (graph_utils)\n'

from outlook_web.i18n import translate as _tr

import email
import imaplib
from email.header import decode_header
from typing import Optional, List, Dict, Any

import requests

# ==================== Configuration parameters ====================
# Email account
EMAIL = ""
# Email password (usually not required, refresh_token is used for OAuth2 authentication)
PASSWORD = ""
# OAuth2 refresh_token
CLIENT_ID = ""
# OAuth2 client_id
REFRESH_TOKEN= ""
# Proxy address (optional, format: host:port or http://host:port)
PROXY = None  # For example: "127.0.0.1:7890"
# ================================================


# Token endpoint
TOKEN_URL_LIVE = "https://login.live.com/oauth20_token.srf"
TOKEN_URL_GRAPH = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
TOKEN_URL_IMAP = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"

# IMAP server configuration
IMAP_SERVER_OLD = "outlook.office365.com"
IMAP_SERVER_NEW = "outlook.live.com"
IMAP_PORT = 993
IMAP_TIMEOUT = int(os.getenv("IMAP_TIMEOUT", "45"))


def print_separator(title: str):
    'Print dividing line'
    print("\n" + "=" * 80)
    print(f"【{title}】")
    print("=" * 80)


def decode_header_value(header_value: str) -> str:
    'Decoding email header fields'
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
    'Print email information'
    if not emails:
        print(_tr('❌ {__0__}: Email not received', f'{method_name}'))
        return

    print(_tr('✅ {__0__}: Successfully obtained {__1__} emails\n', f'{method_name}', f'{len(emails)}'))

    for i, msg in enumerate(emails[:5]):  # Only show the first 5 messages
        print(_tr('  📧 Email {__0__}:', f'{i + 1}'))

        # Get information based on email type
        if isinstance(msg, dict):
            # Graph API returns a dictionary
            subject = msg.get("subject", _tr('No topic'))
            from_info = msg.get("from", {})
            sender = from_info.get("emailAddress", {}).get("address", _tr('Unknown sender'))
            received_time = msg.get("receivedDateTime", _tr('Unknown time'))
            print(_tr('     Topic: {__0__}', f'{subject}'))
            print(_tr('     Sender: {__0__}', f'{sender}'))
            print(_tr('     Time: {__0__}', f'{received_time}'))
        else:
            # IMAP returns email.message.EmailMessage
            subject = decode_header_value(msg.get("Subject", _tr('No topic')))
            sender = decode_header_value(msg.get("From", _tr('Unknown sender')))
            date = msg.get("Date", _tr('Unknown time'))
            print(_tr('     Topic: {__0__}', f'{subject}'))
            print(_tr('     Sender: {__0__}', f'{sender}'))
            print(_tr('     Time: {__0__}', f'{date}'))
        print()


# ==================== Method 1: Old IMAP method ====================

def get_access_token_old(account: str, client_id: str, refresh_token: str) -> Optional[str]:
    '\n    Obtain access_token in the old way\n    Using the login.live.com endpoint\n    '
    print(_tr('  🔑 Obtaining access_token (old version login.live.com)...'))

    try:
        data = {
            'client_id': client_id,
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token
        }

        ret = requests.post(TOKEN_URL_LIVE, data=data, timeout=30)

        if ret.status_code != 200:
            print(_tr('  ❌ Failed to obtain access_token: {__0__}', f'{ret.status_code}'))
            print(_tr('     Response: {__0__}...', f'{ret.text[:200]}'))
            if "User account is found to be in service abuse mode" in ret.text:
                print(_tr('  ⚠️ Account banned!'))
            return None

        access_token = ret.json().get('access_token')
        if access_token:
            print(_tr('  ✅ Access_token successfully obtained, length: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ Obtain access_token exception: {__0__}', f'{e}'))
        return None


def read_emails_imap_old(account: str, client_id: str, refresh_token: str, top: int = 10) -> Optional[List]:
    '\n    Method 1: Old IMAP method to read emails\n    Using outlook.office365.com server\n    '
    print_separator(_tr('Method 1: Old IMAP method (outlook.office365.com)'))

    # 1. Get access_token
    access_token = get_access_token_old(account, client_id, refresh_token)
    if not access_token:
        return None

    # 2. Connect to IMAP server
    connection = None
    try:
        print(_tr('  📡 Connecting to IMAP server: {__0__}...', f'{IMAP_SERVER_OLD}'))
        connection = imaplib.IMAP4_SSL(IMAP_SERVER_OLD, IMAP_PORT, timeout=IMAP_TIMEOUT)

        # 3. XOAUTH2 authentication
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1"
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        print(_tr('  ✅ IMAP authentication successful'))

        # 4. Select your inbox
        connection.select("INBOX")

        # 5. Search mail
        status, messages = connection.search(None, 'ALL')
        if status != 'OK' or not messages or not messages[0]:
            print(_tr('  ⚠️ Inbox is empty'))
            return []

        message_ids = messages[0].split()
        print(_tr('  📬 There are {__0__} emails in the inbox', f'{len(message_ids)}'))

        # 6. Get recent emails
        recent_ids = message_ids[-top:][::-1]  # Reverse order, latest first

        emails = []
        for msg_id in recent_ids:
            try:
                status, msg_data = connection.fetch(msg_id, '(RFC822)')
                if status == 'OK' and msg_data and msg_data[0]:
                    raw_email = msg_data[0][1]
                    msg = email.message_from_bytes(raw_email)
                    emails.append(msg)
            except Exception as e:
                print(_tr('  ⚠️ Failed to parse email {__0__}: {__1__}', f'{msg_id}', f'{e}'))
                continue

        return emails

    except Exception as e:
        print(_tr('  ❌ IMAP connection failed: {__0__}', f'{e}'))
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


# ==================== Method 2: New version of IMAP method ====================

def get_access_token_imap(client_id: str, refresh_token: str) -> Optional[str]:
    '\n    New version method to obtain IMAP access_token\n    Use login.microsoftonline.com/consumers endpoint, IMAP scope\n    '
    print(_tr('  🔑 Obtaining access_token (new version of IMAP scope)...'))

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
            print(_tr('  ❌ Failed to obtain access_token: {__0__}', f'{res.status_code}'))
            print(_tr('     Response: {__0__}...', f'{res.text[:200]}'))
            if "User account is found to be in service abuse mode" in res.text:
                print(_tr('  ⚠️ Account banned!'))
            return None

        access_token = res.json().get("access_token")
        if access_token:
            print(_tr('  ✅ Access_token successfully obtained, length: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ Obtain access_token exception: {__0__}', f'{e}'))
        return None


def read_emails_imap_new(account: str, client_id: str, refresh_token: str, top: int = 10) -> Optional[List]:
    '\n    Method 2: New version of IMAP method to read emails\n    Using outlook.live.com server\n    '
    print_separator(_tr('Method 2: New version of IMAP method (outlook.live.com)'))

    # 1. Get access_token
    access_token = get_access_token_imap(client_id, refresh_token)
    if not access_token:
        return None

    # 2. Connect to IMAP server
    connection = None
    try:
        print(_tr('  📡 Connecting to IMAP server: {__0__}...', f'{IMAP_SERVER_NEW}'))
        connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT, timeout=IMAP_TIMEOUT)

        # 3. XOAUTH2 authentication
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        print(_tr('  ✅ IMAP authentication successful'))

        # 4. Select your inbox
        connection.select('"INBOX"')

        # 5. Search mail
        status, messages = connection.search(None, 'ALL')
        if status != 'OK' or not messages or not messages[0]:
            print(_tr('  ⚠️ Inbox is empty'))
            return []

        message_ids = messages[0].split()
        print(_tr('  📬 There are {__0__} emails in the inbox', f'{len(message_ids)}'))

        # 6. Get recent emails
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
                print(_tr('  ⚠️ Failed to parse email {__0__}: {__1__}', f'{msg_id}', f'{e}'))
                continue

        return emails

    except Exception as e:
        print(_tr('  ❌ IMAP connection failed: {__0__}', f'{e}'))
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


# ==================== Method 3: Graph API method ====================

def get_access_token_graph(client_id: str, refresh_token: str) -> Optional[str]:
    '\n    Obtain access_token through Graph API\n    Use login.microsoftonline.com/common endpoint, Graph scope\n    '
    print(_tr('  🔑 Obtaining access_token (Graph API)...'))

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
            print(_tr('  ❌ Failed to obtain access_token: {__0__}', f'{res.status_code}'))
            print(_tr('     Response: {__0__}...', f'{res.text[:200]}'))
            if "User account is found to be in service abuse mode" in res.text:
                print(_tr('  ⚠️ Account banned!'))
            return None

        access_token = res.json().get("access_token")
        if access_token:
            print(_tr('  ✅ Access_token successfully obtained, length: {__0__}', f'{len(access_token)}'))
        return access_token

    except Exception as e:
        print(_tr('  ❌ Obtain access_token exception: {__0__}', f'{e}'))
        return None


def read_emails_graph(client_id: str, refresh_token: str, top: int = 10) -> Optional[List[Dict]]:
    '\n    Method 3: Reading emails using Graph API\n    Using Microsoft Graph API\n    '
    print_separator(_tr('Method 3: Graph API method'))

    # 1. Get access_token
    access_token = get_access_token_graph(client_id, refresh_token)
    if not access_token:
        return None

    # 2. Call Graph API to get emails
    try:
        proxies = None
        if PROXY:
            proxies = {"http": f"http://{PROXY}", "https": f"http://{PROXY}"}

        print(_tr('  📡 Calling Graph API...'))

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
            print(_tr('  ❌ Graph API call failed: {__0__}', f'{res.status_code}'))
            print(_tr('     Response: {__0__}...', f'{res.text[:200]}'))
            return None

        data = res.json()
        messages = data.get("value", [])
        total = data.get("@odata.count", len(messages))
        print(_tr('  📬 There are {__0__} emails in the inbox', f'{total}'))

        return messages

    except Exception as e:
        print(_tr('  ❌ Graph API call exception: {__0__}', f'{e}'))
        return None


# ==================== Main function ====================

def main():
    'Main function: read emails in three ways'
    print("\n" + _tr('🚀 Outlook email reading test tool'))
    print("=" * 80)
    print(_tr('Email: {__0__}', f'{EMAIL}'))
    print(f"Client ID: {CLIENT_ID}")
    print(f"Refresh Token: {REFRESH_TOKEN[:30]}..." if REFRESH_TOKEN else _tr('Not set'))
    print(_tr('Agent: {__0__}', f"{(PROXY if PROXY else 'None')}"))
    print("=" * 80)

    # Check configuration
    if EMAIL == "" or REFRESH_TOKEN == "":
        print(_tr('\n⚠️ Please configure your email information first!'))
        print(_tr('   Modify the EMAIL, REFRESH_TOKEN, CLIENT_ID variables at the top of the script'))
        return

    results = {}

    # Method 1: Legacy IMAP
    try:
        emails_old = read_emails_imap_old(EMAIL, CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_old, _tr('Legacy IMAP'))
        results[_tr('Legacy IMAP')] = _tr('✅ Success') if emails_old else _tr('❌ failed')
    except Exception as e:
        print(_tr('❌ Old version of IMAP exception: {__0__}', f'{e}'))
        results[_tr('Legacy IMAP')] = _tr('❌ Exception: {__0__}', f'{e}')

    # Method 2: New version of IMAP
    try:
        emails_new = read_emails_imap_new(EMAIL, CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_new, _tr('New version of IMAP'))
        results[_tr('New version of IMAP')] = _tr('✅ Success') if emails_new else _tr('❌ failed')
    except Exception as e:
        print(_tr('❌ New version of IMAP exception: {__0__}', f'{e}'))
        results[_tr('New version of IMAP')] = _tr('❌ Exception: {__0__}', f'{e}')

    # Method 3: Graph API
    try:
        emails_graph = read_emails_graph(CLIENT_ID, REFRESH_TOKEN, top=10)
        print_email_info(emails_graph, "Graph API")
        results["Graph API"] = _tr('✅ Success') if emails_graph else _tr('❌ failed')
    except Exception as e:
        print(_tr('❌ Graph API exception: {__0__}', f'{e}'))
        results["Graph API"] = _tr('❌ Exception: {__0__}', f'{e}')

    # Print summary
    print_separator(_tr('Summary of test results'))
    for method, result in results.items():
        print(f"  {method}: {result}")

    print("\n" + "=" * 80)
    print(_tr('Test completed!'))
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
