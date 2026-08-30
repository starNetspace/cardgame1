"""Generate local CET-6 word audio with edge-tts.

Install the optional generator dependency first with: python -m pip install edge-tts
This script is intentionally separate from the browser build and is not run by Vite.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "library" / "cards" / "cet6_cards.json"
AUDIO_ROOT = ROOT / "public" / "audio" / "words"
MANIFEST_PATH = ROOT / "public" / "audio" / "manifest.json"
FAILURES_PATH = ROOT / "tools" / "audio" / "audio_failures.txt"
MIN_BYTES = 1024
CONCURRENCY = 8

# A carrier phrase gives heteronyms the grammatical context needed to select
# the intended stress pattern. Keys are normalized as word|part-of-speech.
HETERONYM_OVERRIDES = {
    "lead|v": "to lead a team",
    "lead|n": "a lead pipe",
    "record|v": "to record a message",
    "record|n": "a written record",
    "live|v": "to live abroad",
    "live|adj": "a live broadcast",
    "present|v": "to present an idea",
    "present|n": "a birthday present",
    "increase|v": "to increase the price",
    "increase|n": "a sharp increase",
    "object|v": "to object to a plan",
    "object|n": "an everyday object",
    "content|v": "to content oneself",
    "content|n": "the content of a book",
    "minute|n": "one minute",
    "minute|adj": "a minute detail",
}


def slugify(word: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", word.lower()).strip("-")
    return slug or "word"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate CET-6 word pronunciation audio")
    parser.add_argument("--voice", default="en-US-AriaNeural")
    parser.add_argument("--max-level", type=int, choices=range(1, 6), default=None,
                        help="only include cards at or below this frequency level")
    return parser.parse_args()


def collect_targets(max_level: int | None) -> list[tuple[str, str | None, str]]:
    rows = json.loads(SOURCE.read_text(encoding="utf-8"))
    words: dict[str, set[str]] = {}
    display_words: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("word"), str):
            continue
        level = row.get("frequencyLevel")
        if max_level is not None and (not isinstance(level, int) or level > max_level):
            continue
        word = row["word"].strip()
        if not word:
            continue
        normalized = word.lower()
        display_words.setdefault(normalized, word)
        words.setdefault(normalized, set()).add(str(row.get("pos", "")).strip().lower())

    targets: list[tuple[str, str | None, str]] = []
    for normalized, positions in sorted(words.items()):
        word = display_words[normalized]
        override_positions = {pos for pos in positions if f"{normalized}|{pos}" in HETERONYM_OVERRIDES}
        if override_positions:
            for pos in sorted(override_positions):
                targets.append((word, pos, HETERONYM_OVERRIDES[f"{normalized}|{pos}"]))
            # Keep a plain fallback for another card with the same word.
            if len(override_positions) < len(positions):
                targets.append((word, None, word))
        else:
            targets.append((word, None, word))
    return targets


def target_path(word: str, pos: str | None) -> Path:
    slug = slugify(word)
    filename = f"{slug}-{pos}.mp3" if pos else f"{slug}.mp3"
    return AUDIO_ROOT / slug[0] / filename


async def generate_one(word: str, pos: str | None, text: str, voice: str, semaphore: asyncio.Semaphore) -> tuple[str, str | None]:
    path = target_path(word, pos)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size >= MIN_BYTES:
        return (f"{word}|{pos}" if pos else word.lower(), path.as_posix().replace((ROOT / "public").as_posix(), "")), None

    part = path.with_suffix(path.suffix + ".part")
    for attempt in range(4):
        try:
            async with semaphore:
                if part.exists():
                    part.unlink()
                await edge_tts.Communicate(text, voice).save(str(part))
            if part.stat().st_size < MIN_BYTES:
                raise RuntimeError(f"audio smaller than {MIN_BYTES} bytes")
            part.replace(path)
            url = "/audio/words/" + path.relative_to(AUDIO_ROOT).as_posix()
            return (f"{word}|{pos}" if pos else word.lower(), url), None
        except Exception as error:  # noqa: BLE001 - one bad word must not stop a batch
            if attempt < 3:
                await asyncio.sleep(2**attempt)
            else:
                if part.exists():
                    part.unlink()
                return "", f"{word}{f' ({pos})' if pos else ''}: {error}"
    return "", f"{word}: unknown generation failure"


async def main() -> None:
    args = parse_args()
    targets = collect_targets(args.max_level)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(*(generate_one(*target, args.voice, semaphore) for target in targets))
    files: dict[str, str] = {}
    failures: list[str] = []
    for result, failure in results:
        if result:
            key, path = result
            files[key] = path
        if failure:
            failures.append(failure)

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps({"version": 1, "files": dict(sorted(files.items()))}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    FAILURES_PATH.write_text("\n".join(failures) + ("\n" if failures else ""), encoding="utf-8")
    print(f"完成：{len(files)} 个音频可用，{len(failures)} 个失败。")
    if failures:
        print(f"失败列表：{FAILURES_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
