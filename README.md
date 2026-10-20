# CUBEMIX

React/Vite aplikácia s interaktívnou Rubikovou kockou.

## Vývoj

Node.js 22.12+ alebo 24, PNPM 10 a Bun 1.3+:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
pnpm typecheck
pnpm build
```

`verify` kontroluje všetkých 18 ťahov, dosiahnuteľnosť stavov, skrytý force,
animácie a reset. Riešič beží vo Web Workeri a rieši aktuálny stav vrátane
stredných vrstiev a zmien vykonaných force režimom.

## Force

Podrž tlačidlo menu 3 sekundy. Ulož legálny stav ako preset a načítaj ho ako
force. Kocka má dve oddelené vrstvy:

- **Reálny stav:** všetky ťahy, animácie, uloženie presetu a Solve používajú
  úplný fyzicky dosiahnuteľný stav kocky.
- **Force zobrazenie:** všetky tri skryté strany nesú presný uložený preset,
  nezávisle od miešania reálnej vrstvy.

Pred začiatkom každého ťahu sa force z celej pohybujúcej sa kocky odstráni,
vrátane skrytých nálepiek, ktoré môžu počas ťahu prísť do záberu. Po zastavení
sa vráti na skryté strany. Viditeľné strany sa pri miešaní správajú normálne.

Otočenie celej kocky odhalí force vrstvu. Pôvodne viditeľné strany ju dostanú
až po prechode mimo záberu. Keď už všetkých šesť strán zobrazuje force, celý
uložený legálny stav sa naraz prevezme ako nový reálny základ. Ďalšie miešanie
vychádza z neho a pripraví rovnaký force na ďalšie odhalenie. Netreba reset.

Pri zloženom štarte aplikácie a po Reset sa celá kocka dá otáčať až po
piatich dokončených ťahoch vrstiev. Zrušený drag, ťuknutie a automatické ťahy
riešiča sa nepočítajú. Po odhalení force zostáva otáčanie voľné.

**Dvojité ťuknutie na rovnaký rohový dielik kocky** ukončí aktuálny force:
celá kocka prevezme presný uložený stav a force sa odstráni z aktuálnej hry.
Ďalšie miešanie, otáčanie, Solve ani Reset ho už neaktivujú. Uložené presety
zostávajú zachované a dajú sa znova načítať ručne; ďalšie spustenie aplikácie
sa riadi nastavením force pri štarte. Gesto funguje myšou aj dotykom, neplatí
na stredy a hrany a neaktivuje sa pri ťahaní alebo dlhom podržaní.

Zobrazovací prekryv počas prechodu nie je jeden fyzický šesťstranový stav:
spája reálnu a force vrstvu. Do reálneho stavu sa nikdy nekopírujú jednotlivé
force steny, takže nevznikajú nelegálne kombinácie v modeli, histórii ani
uložených presetoch. Prerušené odhalenie ďalším miešaním opäť ukáže reálnu vrstvu.

Reset zachová načítaný force, vymazanie force zachová aktuálny reálny stav.
Solve force pozastaví až do ďalšieho miešania. Poškodené alebo fyzicky nemožné
presety sa nenačítajú.

## Prehliadačové kontroly

```sh
pnpm exec playwright install chromium
pnpm verify:browser
```

Pri systémovom Chromiume nastav `CHROMIUM_PATH=/usr/bin/chromium`.
Test si spustí vlastný vývojový server a overí mobilné ovládanie, force,
Web Worker riešič, reset a správanie bez prístupu k localStorage.
