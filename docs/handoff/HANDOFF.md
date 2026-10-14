# HANDOFF – Odkiaľ Kam – MHD Prešov (chat → Claude Code)

Stav k 2026-10-14 09:50 (Europe/Bratislava). Aktualizoval Claude (claude.ai, projekt AI podnikanie).
Vlastník: Ing. Vladimír Oboňa (Vlado), BEDEKA, s.r.o. Komunikácia po slovensky, tykanie.

> **Repo je verejné.** Tento súbor zámerne neobsahuje osobné údaje (e-maily testerov, telefón), ID platobného profilu, ID hostingu ani lokálne cesty – tie sú len v Claude projekte (`claude/HANDOFF-mhdPO-google-play.md`). Nikdy sem nepíš heslá, kľúče ani obsah secrets.
> Detailný technický stav Play Console a buildov vedie Code v [`docs/GOOGLE-PLAY.md`](../GOOGLE-PLAY.md) – tento súbor ho nenahrádza, dopĺňa ho o stav z chatu.

---

## 1. Úloha pre Code teraz
Žiadna nová úloha zo strany chatu. Pri ďalšej práci:
1. Dodržuj pravidlá buildu z `docs/GOOGLE-PLAY.md` (versionCode len rastie, poznámky `sk`, produkciu neschvaľovať).
2. Ak niečo zmeníš v Play/buildoch, aktualizuj `docs/GOOGLE-PLAY.md` a zapíš sumár do `docs/handoff/LOG.md`.

## 2. Stav (z chatu)
| Oblasť | Stav |
|---|---|
| Play Console | organizácia BEDEKA, s.r.o.; app „Odkiaľ Kam – MHD Prešov“, balík `sk.operatorsystem.mhdpresov`; Play App Signing zapnuté |
| Interné testovanie | posledná verzia 1.6.9 (8. 10., nahrané automaticky); zoznam „Interní testeri“ (2 účty) |
| Produkt Plus | `odkialkam_plus` aktívny, SK 2,49 € s DPH |
| Obsah aplikácie | 10 deklarácií vyplnených (Data safety „nezbiera“, PEGI 3, cieľová skupina 13+) |
| Služba v popredí (poloha) | **chýba video** (YouTube nezaradené) – bez neho nejde odoslať na kontrolu |
| Web / zásady súkromia | GitHub Pages: `/mhdPO/` a `/mhdPO/sukromie/` |
| Apple (iOS) | zápis BEDEKA do Apple Developer Program rozbehnutý, nedokončený |

## 3. Čo musí urobiť Vlado
- Natočiť a nahrať video pre deklaráciu služby v popredí (postup v `docs/GOOGLE-PLAY.md`).
- Platobný profil: bankový účet, daňové údaje, registrácia 15 % poplatku.
- Dokončiť Apple Developer zápis.
- Produkciu v GitHube neschvaľovať, kým nie je deklarácia s videom hotová.

## 4. Otvorené otázky
- Presmerovanie rallysupport.eu → rallysupport.sk (nepovinné, mimo tohto repa).

## TL;DR pre Code
- Zdroj technického stavu = `docs/GOOGLE-PLAY.md`; tento súbor = stav z chatu.
- Žiadne osobné údaje ani ID účtov do tohto verejného repa.
- Po práci záznam do `docs/handoff/LOG.md`.
