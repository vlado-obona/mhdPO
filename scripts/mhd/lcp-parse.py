#!/usr/bin/env python3
"""Parser oficiálneho linkového cestovného poriadku DPMP (PDF) do JSON.

Každá strana PDF obsahuje dva smery jednej linky. Tabuľka smeru má:
  - zoznam zastávok s minútovým posunom od východzej zastávky („12' Trojica“),
  - stĺpec hodín (h.) a v troch stĺpcoch minúty odchodov z východzej zastávky:
    pracovný deň-školský / pracovný deň-prázdniny / sobota, nedeľa, sviatok,
  - vysvetlivky (písmená pri minútach, napr. „A po zastávku Cemjata“).
DPMP: „Pre stanovenie odchodu z ktorejkoľvek ďalšej zastávky je potrebné
k času odchodu spoja pripočítať čas uvedený pred názvom zastávky.“

Čítame po znakoch so súradnicami (pdfplumber), lebo text má rozostupy písmen
a časy sa rozpadajú na znaky („1 3 Z“ = 13Z).

Použitie: python3 scripts/mhd/lcp-parse.py data/dpmp-lcp/LCP-2026-10-01.pdf > data/dpmp-lcp/lcp.json
"""
import json
import re
import sys

import pdfplumber

MIN_RE = re.compile(r'^(\d{2})([A-Z]{0,4})$')


def lines_of(chars, ytol=2.2):
    """Zoskupí znaky do riadkov podľa y (top)."""
    rows = []
    for c in sorted(chars, key=lambda c: (c['top'], c['x0'])):
        if c['text'].strip() == '':
            continue
        for r in rows:
            if abs(r['top'] - c['top']) <= ytol:
                r['chars'].append(c)
                break
        else:
            rows.append({'top': c['top'], 'chars': [c]})
    for r in rows:
        r['chars'].sort(key=lambda c: c['x0'])
    rows.sort(key=lambda r: r['top'])
    return rows


def tokens(chars, gap=1.6):
    """Spojí znaky do slov podľa medzery medzi nimi; vracia [(text, x0, x1)]."""
    out = []
    for c in sorted(chars, key=lambda c: c['x0']):
        if out and c['x0'] - out[-1][2] <= gap:
            t, x0, _ = out[-1]
            out[-1] = (t + c['text'], x0, c['x1'])
        else:
            out.append((c['text'], c['x0'], c['x1']))
    return out


def join_text(chars, gap=1.6):
    return ' '.join(t for t, _, _ in tokens(chars, gap))


def cell_edges(rects, x_h):
    """Hranice stĺpcov z podfarbenia buniek (obdĺžniky riadkov tabuľky)."""
    xs = sorted({round(v, 1) for r in rects if r['height'] < 15 and x_h - 2 < r['x0'] < 400
                 for v in (r['x0'], r['x1']) if v > x_h + 3})
    merged = []
    for x in xs:
        if merged and x - merged[-1][-1] < 12:
            merged[-1].append(x)
        else:
            merged.append([x])
    return [sum(g) / len(g) for g in merged]


def parse_block(chars, page_no, words, rects=()):
    hdr = [w for w in words if w['text'] == 'Linka']
    if not hdr:
        return None
    lk = hdr[0]
    line_no = ''.join(w['text'] for w in words
                      if abs(w['top'] - lk['top']) < 8 and lk['x1'] < w['x0'] < lk['x1'] + 80
                      and re.match(r'^[0-9A-Z]+$', w['text']))
    smer_w = [w for w in words if w['text'] == 'smer']
    smer = ''
    if smer_w:
        s = smer_w[0]
        smer = ' '.join(w['text'] for w in sorted(words, key=lambda w: w['x0'])
                        if abs(w['top'] - s['top']) < 3 and w['x0'] > s['x1'])
    odch = [w for w in words if w['text'] == 'Odchody']
    start_stop = ''
    if odch:
        o = odch[0]
        ws = [w['text'] for w in sorted(words, key=lambda w: w['x0']) if abs(w['top'] - o['top']) < 3 and w['x0'] > o['x1']]
        start_stop = ' '.join(ws[2:]) if len(ws) > 2 else ''

    # hlavička stĺpcov
    def first_x(pred):
        xs = [w['x0'] for w in words if pred(w['text'])]
        return min(xs) if xs else None

    x_h = first_x(lambda t: t == 'h.')
    x_school = first_x(lambda t: 'školský' in t or t == 'deň-školský')
    x_holi = first_x(lambda t: 'prázdniny' in t)
    x_week = first_x(lambda t: t.startswith('sobota') or t.startswith('nedeľa'))
    # v jednoriadkovej hlavičke je pred „deň-prázdniny“ slovo „pracovný“
    for w in words:
        if 'deň-prázdniny' in w['text']:
            prev = [v for v in words if abs(v['top'] - w['top']) < 2 and v['x1'] <= w['x0'] + 1 and w['x0'] - v['x1'] < 6]
            if prev:
                x_holi = min(x_holi, min(v['x0'] for v in prev))
    x_leg = first_x(lambda t: t.startswith('VYSVETLIVKY'))
    legend_right = x_leg is not None and x_week is not None and x_leg > x_week
    # varianty hlavičky: školský + prázdniny + víkend, alebo jeden stĺpec
    # „pracovný deň“ (platí v školské aj prázdninové dni) + víkend
    single_workday = x_school is None and x_holi is None
    if single_workday:
        x_school = first_x(lambda t: t == 'pracovný')
        x_holi = x_week  # prázdninový stĺpec neexistuje
    if None in (x_h, x_school, x_holi, x_week):
        raise ValueError(f'strana {page_no}: neúplná hlavička {line_no} {smer} {(x_h, x_school, x_holi, x_week)}')
    b_holi = (x_week - 8) if single_workday else x_holi - 16
    b_week = x_week - 8
    b_end = (x_leg - 3) if legend_right else 10_000
    # presnejšie: hranice z podfarbenia buniek, ak sú k dispozícii
    edges = cell_edges(rects, x_h)
    need = 3 if single_workday else 4
    edge_src = 'header'
    if len(edges) >= need:
        if single_workday:
            b_holi = b_week = edges[1]
            b_end = edges[2]
        else:
            b_holi, b_week, b_end = edges[1], edges[2], edges[3]
        edge_src = 'cells'

    rows = lines_of(chars)
    deps = {'school': [], 'holiday': [], 'weekend': []}
    stops = []
    hours_seen = []
    for r in rows:
        toks = tokens(r['chars'])
        # hodina v stĺpci h.
        hour = None
        for t, x0, _ in toks:
            if abs(x0 - x_h) < 6 and re.match(r'^\d{1,2}$', t):
                hour = int(t)
        if hour is not None:
            hours_seen.append(hour)
            for t, x0, _ in toks:
                if x0 < x_h + 8 or x0 >= b_end:
                    continue
                # zlepené časy bez medzery („00T04A“ = 00T a 04A)
                if not re.match(r'^(\d{2}[A-Z]{0,4})+$', t):
                    continue
                col = 'school' if x0 < b_holi else 'holiday' if x0 < b_week else 'weekend'
                for part in re.findall(r'\d{2}[A-Z]{0,4}', t):
                    m = MIN_RE.match(part)
                    d = {'h': hour, 'm': int(m.group(1)), 'flags': m.group(2), 'x': round(x0, 1)}
                    deps[col].append(d)
                    if single_workday and col == 'school':
                        deps['holiday'].append(dict(d))
        # zastávka: posun v stĺpci min. + názov; posun môže byť rozsah
        # príchod-odchod („9-10' Trojica“ = autobus na zastávke čaká)
        left = [c for c in r['chars'] if c['x0'] < 115]
        if left and left[0]['x0'] < 32:
            txt = join_text(left)
            mo = re.match(r"^(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*'\s*(.+)$", txt)
            if mo:
                arr = int(mo.group(1))
                dep = int(mo.group(2)) if mo.group(2) else arr
                stops.append({'off': dep, 'arr': arr, 'name': mo.group(3).strip(), 'top': round(r['top'], 1)})

    # vysvetlivky
    legend = {}
    if x_leg is not None:
        lw = [w for w in words if w['text'].startswith('VYSVETLIVKY')][0]
        if legend_right:
            leg_chars = [c for c in chars if c['x0'] >= x_leg - 12 and c['top'] > lw['top'] - 1]
        else:
            leg_chars = [c for c in chars if c['top'] >= lw['top'] - 1 and c['x0'] < 300]
        text_lines = [join_text(r['chars']) for r in lines_of(leg_chars)]
        blob = ' '.join(text_lines).replace('VYSVETLIVKY:', ' ')
        blob = re.sub(r'Tolerancia.*$|Platnos.*$', '', blob)
        for m in re.finditer(r'(?:^|\s)([A-Z])\s+(?=\S)(.+?)(?=\s[A-Z]\s+(?:po|zo|ďalej|zachádza|z\s|cez|iba|len|prem|nepre|odchod|príchod|ide)|$)', blob):
            legend[m.group(1)] = m.group(2).strip()
    valid = None
    vm = re.search(r'Platnos[ťt]\s*od\s*([\d.\s]+\d{4})', ' '.join(w['text'] for w in words))
    if vm:
        valid = re.sub(r'\s+', '', vm.group(1))
    return {
        'page': page_no, 'line': line_no, 'smer': smer, 'start': start_stop,
        'valid_from': valid, 'stops': stops, 'deps': deps, 'legend': legend,
        'single_workday': single_workday, 'edge_src': edge_src,
        'cols': {'h': x_h, 'school': x_school, 'holiday': x_holi, 'weekend': x_week, 'legend_right': legend_right,
                 'b_holi': b_holi, 'b_week': b_week, 'b_end': b_end},
        'hours': hours_seen,
    }


def main(path):
    pdf = pdfplumber.open(path)
    out = []
    for i, p in enumerate(pdf.pages):
        words = p.extract_words(x_tolerance=1.5, y_tolerance=2)
        heads = sorted([w for w in words if w['text'] == 'Linka'], key=lambda w: w['top'])
        if not heads:
            continue
        # hranica blokov: tesne nad riadkom „Odchody zo zastávky“ daného bloku
        tops = []
        for h in heads:
            od = [w for w in words if w['text'] == 'Odchody' and h['top'] - 12 < w['top'] <= h['top']]
            tops.append((od[0]['top'] if od else h['top']) - 3)
        bounds = tops + [p.height]
        for k in range(len(heads)):
            y0, y1 = bounds[k], bounds[k + 1]
            ch = [c for c in p.chars if y0 <= c['top'] < y1 - 0.5]
            ws = [w for w in words if y0 <= w['top'] < y1 - 0.5]
            rc = [r for r in p.rects if y0 <= r['top'] < y1 - 0.5]
            blk = parse_block(ch, i, ws, rc)
            if blk:
                out.append(blk)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1])
