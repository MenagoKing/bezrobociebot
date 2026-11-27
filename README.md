# SolDesk

Panel i silnik do prowadzenia **własnego** bota handlowego na Solanie i sieciach EVM (domyślnie Robinhood Chain):
wybór tokena po adresie kontraktu lub linku, analiza dynamiki rynku (7 scenariuszy), strategia z limitami ryzyka,
kolejka zleceń, statystyki w walucie sieci (SOL/ETH) i USD, dziennik ogłoszeń o transakcjach i monitoring — wszystko
konfigurowalne z panelu.

- **Tryb paper (domyślny):** symulowane wykonanie po bieżących cenach rynkowych, z prowizją, poślizgiem, opłatami sieci (i rentem na Solanie).
- **Tryb live:** prawdziwe transakcje podpisywane lokalnie Twoim kluczem — na Solanie przez Jupiter, na sieciach EVM przez LI.FI.
  Domyślnie **wyłączony** na serwerze.
- **Dane:** rzeczywiste (DexScreener + GeckoTerminal) albo wbudowany symulator rynku (testy bez sieci).

## Sieci

| Sieć | Adres tokena | Waluta | Wykonanie live | Domyślnie |
|---|---|---|---|---|
| Solana | base58 (Pump.fun, zwykle kończy się na „pump”) | SOL | Jupiter Swap API | włączona |
| Robinhood Chain (chain ID 4663) | `0x…` | ETH | LI.FI (pule Uniswap v4 i inne) | włączona |
| Base, Ethereum, Arbitrum, BNB Smart Chain | `0x…` | ETH / BNB | LI.FI | wyłączone (System → Sieci EVM) |

Adres `0x…` jest szukany na włączonych sieciach EVM; wybierana jest ta, na której token ma największą płynność.
Jeśli token jest na sieci wyłączonej lub nieskonfigurowanej, panel to wyświetli. Sieci (RPC, eksplorator, opłaty, rezerwa
na gaz, allowlista kontraktów) edytujesz w zakładce **System → Sieci EVM** — można też dodać własną sieć EVM.

Architektura, schemat bazy, maszyna stanów i koordynator: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Szybki start (lokalnie)

Wymagania: Node.js ≥ 24 (serwer uruchamia TypeScript natywnie, bez kroku kompilacji).

```powershell
npm install
```

```powershell
npm run build
```

```powershell
npm start
```

Otwórz http://127.0.0.1:8787 — przy pierwszym uruchomieniu z localhost ustawisz hasło administratora.

> **Windows / PowerShell:** jeśli pojawia się błąd „npm.ps1 cannot be loaded because running scripts is disabled”,
> użyj `npm.cmd` zamiast `npm` (np. `npm.cmd start`) albo uruchom serwer bezpośrednio: `node server/src/index.ts`.
> Polecenia trzeba wykonywać w folderze projektu.
Tryb deweloperski z automatycznym przeładowaniem (panel na http://localhost:5173):

```powershell
npm run dev
```

Testy i kontrola typów:

```powershell
npm test
```

```powershell
npm run typecheck
```

## Jak zacząć handlować (paper)

1. **Session Control** → wklej adres kontraktu tokena; nazwa, symbol, cena i płynność pojawią się automatycznie.
2. Wybierz dane (rzeczywiste / symulator), tryb **Paper** i kapitał symulacyjny → **Start**.
3. Obserwuj **Overview** (wykres, wynik, operacje) i **Market Dynamics** (scenariusz i wskaźniki).
4. Strojenie: **Trading Config** (kwoty, czasy, TP/SL/trailing, scenariusze wejścia/wyjścia, limity ryzyka, presety).
5. **Pause / Resume / Stop** w Session Control; **EMERGENCY STOP** jest zawsze na górnym pasku.

Każda transakcja wynika z reguły strategii (`strategy:…`) albo z polecenia z panelu (`manual:…`) — powód jest zapisany
przy zleceniu, transakcji i pozycji.

## Tryb live (prawdziwe środki)

Włączenie wymaga trzech świadomych kroków:

1. W `.env` ustaw `LIVE_TRADING_ENABLED=true` i zrestartuj serwer.
2. **Konto i portfel** → dodaj klucz prywatny portfela (szyfrowany AES-256-GCM; adres portfela ustawi się sam):
   dla Solany „Klucz prywatny portfela”, dla Robinhood Chain i innych sieci EVM „Klucz prywatny portfela EVM”
   (64 znaki hex). Najlepiej użyj osobnego portfela tylko z kwotą przeznaczoną na bota.
3. Przy starcie sesji wybierz tryb Live i wpisz frazę potwierdzającą `HANDEL LIVE`.

Zanim użyjesz prawdziwych pieniędzy:

- **Koszty przy małym kapitale są wysokie.** Pierwszy zakup tokena tworzy konto tokena (rent ≈ 0,002 SOL), do tego prowizja
  platformy (~1% w każdą stronę), poślizg i opłaty sieci. Przy 1–2 USD kapitału sam rent to 10–20% kapitału —
  zakładka Trading Config pokazuje szacunek kosztu pełnego cyklu dla Twoich kwot.
- Wykonanie live (quote → swap → podpis → potwierdzenie → odczyt faktycznych kwot z transakcji) jest zaimplementowane
  i pokryte testami podpisu, ale **nie było testowane na mainnecie** w tym projekcie. Zacznij od minimalnych kwot
  i sprawdź pierwsze transakcje w Solscan.
- Podpisywane są wyłącznie transakcje, w których płatnikiem i jedynym sygnatariuszem jest Twój portfel.
- **Sieci EVM:** przed podpisem sprawdzane są sieć, nadawca i dokładna kwota, a kontrakt docelowy (i ewentualny approve)
  musi być na allowliście sieci (domyślnie kontrakt LI.FI). Sprzedaż zatwierdza dokładnie sprzedawaną ilość tokena,
  nigdy nieograniczoną. Faktyczne kwoty i gaz są odczytywane z sald portfela przed i po bloku transakcji.
  Wykonanie EVM jest pokryte testami jednostkowymi i sprawdzone na prawdziwych wycenach LI.FI, ale **nie wysłano nim
  prawdziwej transakcji** — zacznij od minimalnych kwot. Bez klucza API LI.FI obowiązują limity zapytań (klucz można dodać w zakładce Konto).
- Publiczny RPC (`api.mainnet-beta.solana.com`) ma limity — do live użyj prywatnego RPC (URL zapisujesz jako sekret w zakładce Konto).
- Wynik live liczony jest od salda SOL portfela na starcie sesji — wpłaty/wypłaty w trakcie sesji zaburzą PNL.

### Kilka portfeli (jedna pozycja na portfel)

**Konto i portfel → Portfele handlowe → Dodaj portfel** (nowy albo import klucza) dodaje portfele, z których bot otwiera
pozycje obok portfela głównego. W **Trading Config → Maks. pozycji na jeden portfel** ustaw `1`, a „Maks. liczba otwartych
pozycji” na liczbę portfeli — wtedy każda pozycja idzie z osobnego portfela (np. 2 portfele = 2 pozycje naraz, każda na innym).
Bot wybiera najmniej zajęty portfel z wystarczającym saldem; sprzedaż zawsze idzie z portfela, który pozycję otworzył.
Kapitał sesji live to suma sald wszystkich portfeli danej sieci. Dodawanie, włączanie/wyłączanie i usuwanie portfeli
jest możliwe tylko poza sesją live; usunięty portfel trafia do archiwum (klucz zostaje). W trybie paper limit działa tak
samo (do testów), ale saldo symulacyjne jest wspólne.

## Wdrożenie na serwer (24/7)

**Docker + HTTPS (zalecane):**

1. Skopiuj `.env.example` → `.env`, ustaw `ADMIN_PASSWORD` i `MASTER_KEY` (kopię `MASTER_KEY` trzymaj poza serwerem).
2. W `deploy/Caddyfile` wpisz swoją domenę (rekord DNS A → IP serwera).
3. `docker compose up -d --build` — aplikacja restartuje się automatycznie po awarii, Caddy wystawia certyfikat TLS.

**Bez Dockera:** `deploy/soldesk.service` (systemd, `Restart=always`, ograniczone uprawnienia) + dowolny reverse proxy z HTTPS.

Odporność: stan w SQLite (WAL); po restarcie aktywna sesja wraca jako **wstrzymana** (chyba że włączysz
„Wznawiaj sesję po restarcie”), zlecenia przerwane w trakcie są uzgadniane z siecią po podpisie transakcji.
Feed rynkowy przy błędach przechodzi w stan `degraded`/`down` z wydłużanym odstępem prób; nieaktualne dane blokują decyzje.

Kopie zapasowe: automatycznie co N godzin do `data/backups` (rotacja), ręcznie z zakładki System;
`deploy/offsite-backup.sh` — przykład kopii poza serwer.

### Wymagania sprzętowe

Aplikacja nie uruchamia przeglądarek — handel idzie bezpośrednio przez API, więc zużycie zasobów jest małe:

| Zasób | Minimum | Zalecane |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 1 GB |
| Dysk | 2 GB SSD | 10 GB SSD (logi, kopie) |
| Sieć | stałe łącze, niskie opóźnienia do RPC | jw. + prywatny RPC |

Zmierzone lokalnie: ~100 MB RAM, CPU bliskie 0% przy jednej sesji.

## Bezpieczeństwo

- Logowanie hasłem (scrypt), sesja w ciasteczku `HttpOnly; SameSite=Strict` (+ `Secure` za HTTPS), limit prób logowania,
  ochrona CSRF nagłówkiem, nagłówki bezpieczeństwa (CSP, X-Frame-Options).
- Sekrety (klucz portfela, prywatny URL RPC) szyfrowane AES-256-GCM kluczem głównym spoza bazy; podgląd wymaga ponownego
  podania hasła i jest odnotowywany w logu (bez wartości). Logi przechodzą redakcję kluczy, haseł i parametrów `api-key`.
- Panel domyślnie nasłuchuje tylko na `127.0.0.1`; na serwerze wystawiaj go wyłącznie przez HTTPS.

## Ogłoszenia (Callout Manager)

Szablony z zmiennymi (`{symbol}`, `{buy_price}`, `{pnl_usd}`…), kategorie, import hurtowy, częstotliwość i zdarzenia
wyzwalające, kolejka zatwierdzeń. Ogłoszenia powstają tylko z faktycznie wykonanych transakcji, zawsze z etykietą
treści automatycznej. Moduł niczego nie publikuje na zewnątrz — zatwierdzoną treść kopiujesz sam.

## Rozbudowa

- Nowa strategia: funkcje `evaluateEntry` / `evaluateExit` w `server/src/engine/strategy.ts` (czyste funkcje, łatwe do testów).
- Nowe źródło danych: interfejs `MarketProvider` (`server/src/market/provider.ts`).
- Nowy sposób wykonania: interfejs `Executor` (`server/src/execution/executor.ts`).
- Nowa sieć EVM: wpis w System → Sieci EVM (bez zmian w kodzie); logika sieci w `server/src/chains/chainRegistry.ts`.
- Nowe ustawienie: schemat w `server/src/config/schema.ts` + pole w odpowiednim formularzu panelu.
- Migracje bazy: dopisz kolejny element w `server/src/db/migrations.ts`.

## Ograniczenia

- Pozycje zamykane są w całości (brak częściowych wyjść).
- Pola z sufiksem `Sol` w kodzie i bazie oznaczają kwoty w walucie natywnej sieci sesji (SOL, ETH, BNB) — nazwy zostały
  zachowane dla zgodności danych; symbol waluty jest w `nativeSymbol`.
- Wykonanie live zależy od tras agregatora: na Solanie od Jupitera, na sieciach EVM od LI.FI. Tokeny, dla których
  agregator nie ma trasy (np. przed migracją z krzywej bondingowej do DEX), nie dostaną wyceny — zlecenie zakończy się błędem.
- Ceny z DexScreener mają ograniczoną precyzję (ok. 4 cyfry znaczące) — wpływa to na dokładność wyceny w trybie paper.
- Adres Jupiter API (`lite-api.jup.ag`) może się zmienić — da się go podmienić w zakładce System.
