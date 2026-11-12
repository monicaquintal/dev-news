"""Tradução EN -> PT offline (modelo Argos + ctranslate2).

Uso: python3 scripts/translate.py < entrada.json > saida.json
Entrada: lista JSON de strings. Saída: objeto JSON {original: traducao}.
Na primeira execução baixa o modelo (~64 MB) para .cache/argos/.
"""
import json, os, sys, urllib.request, zipfile

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
    out = {}
    for i in range(0, len(titles), 32):
        batch = titles[i:i + 32]
        toks = [sp.encode(t, out_type=str) for t in batch]
        res = tr.translate_batch(toks, beam_size=2, max_batch_size=32, max_decoding_length=128)
        for t, r in zip(batch, res):
            out[t] = "".join(r.hypotheses[0]).replace("▁", " ").strip()
    json.dump(out, sys.stdout, ensure_ascii=False)


main()
