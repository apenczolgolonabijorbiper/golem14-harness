"""Deterministic source indexer. Does not interpret observations or infer claims."""
from pathlib import Path
import hashlib, json, re
import argparse
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True, help='Private instance directory')
ROOT=parser.parse_args().root.resolve()
(ROOT/"evidence").mkdir(exist_ok=True)
for source in sorted((ROOT/"inbox").glob("*.md")):
    content=source.read_text(encoding="utf-8")
    if not content.startswith("---\n") or "\n---\n" not in content[4:]:
        print("Malformed:",source.name);continue
    header,body=content[4:].split("\n---\n",1)
    fields=dict(re.findall(r"^([a-z_]+):\s*(.*)$",header,re.M))
    uid=fields.get("id","")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}",uid):
        print("Invalid ID:",source.name);continue
    out=ROOT/"evidence"/(uid+".json")
    if out.exists():continue
    evidence={"id":uid,"source_file":source.relative_to(ROOT).as_posix(),"sha256":hashlib.sha256(content.encode()).hexdigest(),"recorded_at":fields.get("recorded_at"),"event_date":fields.get("event_date"),"kind":fields.get("kind"),"text":body.strip(),"interpretation":"not_inferred"}
    if fields.get("question_id"):
        try:
            question_text=json.loads(fields.get("question_text", '""'))
        except json.JSONDecodeError:
            question_text=fields.get("question_text")
        evidence["question"]={"id":fields["question_id"],"text":question_text,"source":fields.get("question_source")}
    out.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Indexed:",uid)
