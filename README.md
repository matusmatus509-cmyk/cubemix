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
force. Po piatich dokončených ťahoch sa force aktivuje. Pri každom pohľade
mení iba bezpečne skryté nálepky. Viditeľné a hraničné steny sú chránené;
celá kocka musí mať platné dieliky, orientácie, paritu a počty farieb.

Nie každý preset je kompatibilný s práve viditeľnými nálepkami. Vtedy sa
vykoná iba legálna skrytá časť zmeny; zvyšok vyžaduje ďalšie otočenie alebo
zamiešanie. Okamžité dokončenie ľubovoľného presetu pri ľubovoľnom pohľade sa
nezaručuje. Preset sa pri ťahoch stredných vrstiev priestorovo zarovná podľa
stredov aktuálnej kocky. Force nikdy automaticky neotáča viditeľné vrstvy.

Reset zachová načítaný force, vymazanie force zachová aktuálny legálny stav.
Po dokončení sa force opäť pripraví pri ďalšom miešaní. Poškodené alebo
fyzicky nemožné staré presety sa nenačítajú.

## Prehliadačové kontroly

```sh
pnpm exec playwright install chromium
pnpm verify:browser
```

Pri systémovom Chromiume nastav `CHROMIUM_PATH=/usr/bin/chromium`.
Test si spustí vlastný vývojový server a overí mobilné ovládanie, force,
Web Worker riešič, reset a správanie bez prístupu k localStorage.
