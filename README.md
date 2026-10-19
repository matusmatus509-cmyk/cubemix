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
vychádza z neho a pripraví rovnaký force na ďalšie odhalenie. Netreba reset ani
päť úvodných ťahov; otáčanie celej kocky nie je zamknuté.

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
