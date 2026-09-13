import imaplib
import ssl
import sys
import time
import re

SRC_HOST = "186.240.156.46"
SRC_PORT = 993
SRC_USER = "ectr@normassistance.com.tr"
SRC_PASS = "Ectr2426."

DST_HOST = "imap.yandex.com"b
DST_PORT = 993
DST_USER = "destek@normassistance.com.tr"
DST_PASS = "Destek1645"

def get_connections():
    src_ctx = ssl.create_default_context()
    src_ctx.check_hostname = False
    src_ctx.verify_mode = ssl.CERT_NONE

    dst_ctx = ssl.create_default_context()

    for attempt in range(5):
        try:
            src = imaplib.IMAP4_SSL(SRC_HOST, SRC_PORT, ssl_context=src_ctx)
            src.login(SRC_USER, SRC_PASS)

            dst = imaplib.IMAP4_SSL(DST_HOST, DST_PORT, ssl_context=dst_ctx)
            dst.login(DST_USER, DST_PASS)

            return src, dst
        except Exception as e:
            print(f"Connection attempt {attempt+1} failed: {e}. Retrying in 5s...", flush=True)
            time.sleep(5)
    raise RuntimeError("Could not establish connections to IMAP servers")

def parse_internal_date(raw_header_bytes):
    try:
        text = raw_header_bytes.decode("latin1", "ignore")
        m = re.search(r'INTERNALDATE\s+"([^"]+)"', text, re.IGNORECASE)
        if m:
            raw_date = m.group(1).strip()
            parts = raw_date.split()
            dt_str = f"{parts[0]} {parts[1]}"
            tm = time.strptime(dt_str, "%d-%b-%Y %H:%M:%S")
            return imaplib.Time2Internaldate(tm)
    except Exception:
        pass
    return None

def migrate_folder(folder):
    print(f"\n==========================================", flush=True)
    print(f"Starting Migration to Destek for folder: {folder}", flush=True)
    print(f"==========================================", flush=True)

    src, dst = get_connections()

    res, data = src.select(f'"{folder}"')
    if res != "OK":
        print(f"Cannot select {folder} on source", flush=True)
        return

    if folder.upper() != "INBOX":
        try:
            dst.create(f'"{folder}"')
        except Exception:
            pass
    dst.select(f'"{folder}"')

    typ, dst_data = dst.search(None, "ALL")
    already_copied = len(dst_data[0].split()) if typ == "OK" and dst_data[0] else 0
    print(f"Destek currently has: {already_copied} messages in {folder}", flush=True)

    typ, msg_data = src.search(None, "ALL")
    if typ != "OK":
        return
    msg_ids = msg_data[0].split()
    total_src = len(msg_ids)
    print(f"Source has: {total_src} messages in {folder}", flush=True)

    if already_copied >= total_src:
        print(f"Folder {folder} already fully migrated to Destek!", flush=True)
        try:
            src.logout()
            dst.logout()
        except Exception:
            pass
        return

    pending_ids = msg_ids[already_copied:]
    print(f"Resuming from index {already_copied} ({len(pending_ids)} remaining)...", flush=True)

    processed_in_session = 0
    start_time = time.time()

    for idx, num in enumerate(pending_ids):
        if processed_in_session > 0 and processed_in_session % 250 == 0:
            print(f"Refreshing IMAP connections at count {already_copied + idx}...", flush=True)
            try:
                src.logout()
                dst.logout()
            except Exception:
                pass
            src, dst = get_connections()
            src.select(f'"{folder}"')
            dst.select(f'"{folder}"')

        for retry in range(3):
            try:
                typ, fetched = src.fetch(num, "(INTERNALDATE FLAGS RFC822)")
                if typ != "OK" or not fetched or not isinstance(fetched[0], tuple):
                    break

                raw_headers = fetched[0][0]
                raw_msg = fetched[0][1]

                date_str = parse_internal_date(raw_headers)

                raw_flags = imaplib.ParseFlags(raw_headers)
                flags_str = ""
                if raw_flags:
                    flags_decoded = []
                    for f in raw_flags:
                        if isinstance(f, bytes):
                            flags_decoded.append(f.decode("latin1", "ignore"))
                        else:
                            flags_decoded.append(str(f))
                    flags_str = " ".join(flags_decoded)

                res, data = dst.append(f'"{folder}"', flags_str, date_str, raw_msg)
                if res == "OK":
                    processed_in_session += 1
                    current_total = already_copied + idx + 1
                    if current_total % 100 == 0 or current_total == total_src:
                        elapsed = time.time() - start_time
                        speed = (idx + 1) / elapsed if elapsed > 0 else 0
                        print(f"[{folder}] Migrated {current_total}/{total_src} messages to Destek ({current_total*100//total_src}%) - {speed:.1f} msg/sec", flush=True)
                    break
                else:
                    print(f"Append error on {num.decode()}: {data}", flush=True)
                    time.sleep(1)
            except Exception as e:
                print(f"Error on message {num.decode()} (retry {retry+1}): {e}. Reconnecting...", flush=True)
                time.sleep(2)
                try:
                    src, dst = get_connections()
                    src.select(f'"{folder}"')
                    dst.select(f'"{folder}"')
                except Exception:
                    pass

    try:
        src.logout()
        dst.logout()
    except Exception:
        pass
    print(f"Folder {folder} completed for Destek!", flush=True)

def main():
    print("=== Mail Migration to Destek Started ===", flush=True)
    migrate_folder("INBOX")
    migrate_folder("Sent")
    print("=== ALL FOLDERS FULLY MIGRATED TO DESTEK! ===", flush=True)

if __name__ == "__main__":
    main()
