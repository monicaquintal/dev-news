"""Tradução EN -> PT offline (modelo Argos + ctranslate2).

Uso: python3 scripts/translate.py < entrada.json > saida.json
Entrada: lista JSON de strings. Saída: objeto JSON {original: traducao}.
Na primeira execução baixa o modelo (~64 MB) para .cache/argos/.
"""
import json, os, re, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".pydeps"))

import ctranslate2, sentencepiece  # noqa: E402

MODEL_URL = "https://argos-net.com/v1/translate-en_pt-1_9.argosmodel"
MODEL_DIR = os.path.join(ROOT, ".cache", "argos")
PKG = os.path.join(MODEL_DIR, "translate-en_pt-1_9")


def ensure_model():
    if os.path.isdir(os.path.join(PKG, "model")):
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    local = os.path.join(ROOT, ".cache", "argos-model-dl", "en_pt.argosmodel")
    if not os.path.exists(local):
        local = os.path.join(MODEL_DIR, "en_pt.argosmodel")
        print("baixando modelo en-pt...", file=sys.stderr)
        # o servidor devolve 403 para o User-Agent padrão do urllib
        req = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Mozilla/5.0 (dev-news)"})
        with urllib.request.urlopen(req, timeout=300) as r, open(local, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
    with zipfile.ZipFile(local) as z:
        for n in z.namelist():
            if n.startswith("translate-en_pt-1_9/model/") or n.endswith("sentencepiece.model"):
                z.extract(n, MODEL_DIR)


def main():
    titles = json.load(sys.stdin)
    if not titles:
        print("{}")
        return
    ensure_model()
    sp = sentencepiece.SentencePieceProcessor(model_file=os.path.join(PKG, "sentencepiece.model"))
    tr = ctranslate2.Translator(os.path.join(PKG, "model"), device="cpu", inter_threads=1, intra_threads=os.cpu_count() or 2)
    # textos longos (resumos) são traduzidos frase a frase, que é onde o modelo vai melhor
    parts = {t: split_sentences(t) for t in titles}
    flat = sorted({p for ps in parts.values() for p in ps})
    tx = {}
    for i in range(0, len(flat), 32):
        batch = flat[i:i + 32]
        toks = [sp.encode(t, out_type=str) for t in batch]
        res = tr.translate_batch(toks, beam_size=2, max_batch_size=32, max_decoding_length=160)
        for t, r in zip(batch, res):
            tx[t] = "".join(r.hypotheses[0]).replace("▁", " ").strip()
    out = {t: " ".join(tx[p] for p in ps).strip() for t, ps in parts.items()}
    json.dump(out, sys.stdout, ensure_ascii=False)


def split_sentences(text):
    if len(text) <= 120:
        return [text]
    parts = re.split(r'(?<=[.!?…])\s+(?=[A-ZÀ-Ý0-9"“‘(])', text)
    return [p for p in (s.strip() for s in parts) if p] or [text]


main()
