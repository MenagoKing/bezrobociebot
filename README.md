# SolDesk

Panel i silnik do prowadzenia **własnego** bota handlowego na Solanie i sieciach EVM (domyślnie Robinhood Chain):
wybór tokena po adresie kontraktu lub linku, analiza dynamiki rynku (7 scenariuszy), strategia z limitami ryzyka,
kolejka zleceń, statystyki w walucie sieci (SOL/ETH) i USD i monitoring — wszystko
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
| Base, Ethereum, Arbitrum, BNB Smart Chain | `0x…` | ETH / BNB | LI.FI | wyłączone (Ustawienia → Sieci i połączenia) |

Adres `0x…` jest szukany na włączonych sieciach EVM; wybierana jest ta, na której token ma największą płynność.
Jeśli token jest na sieci wyłączonej lub nieskonfigurowanej, panel to wyświetli. Sieci (RPC, eksplorator, opłaty, rezerwa
na gaz, allowlista kontraktów) edytujesz w **Ustawienia → Sieci i połączenia** — można też dodać własną sieć EVM.

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

Otwórz http://127.0.0.1:8787 — panel nie ma hasła i działa tylko na komputerze, na którym jest uruchomiony.

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

1. **Start** → wklej adres kontraktu tokena; otworzy się podgląd z ceną, wykresem i analizą rynku.
2. Ustaw zachowanie bota, wybierz tryb **Paper** i kapitał symulacyjny → **Uruchom bota**. „Wyjdź” na dole wraca do wyboru tokena.
3. Obserwuj zakładkę **Start** (wykres, wynik, operacje, sterowanie) i **Ustawienia → Analiza rynku** (scenariusz i wskaźniki).
4. Strojenie: **Ustawienia → Strategia** i **Ryzyko** (kwoty, czasy, TP/SL/trailing, scenariusze wejścia/wyjścia, limity ryzyka, presety).
5. **Wstrzymaj / Wznów / Zakończ / Emergency stop** — w zakładce Start, panel „Sterowanie sesją”.

Każda transakcja wynika z reguły strategii (`strategy:…`) albo z polecenia z panelu (`manual:…`) — powód jest zapisany
przy zleceniu, transakcji i pozycji.

## Tryb live (prawdziwe środki)

Włączenie wymaga trzech świadomych kroków:

1. W `.env` ustaw `LIVE_TRADING_ENABLED=true` i zrestartuj serwer.
2. **Konta** → dodaj klucz prywatny portfela (szyfrowany AES-256-GCM; adres portfela ustawi się sam):
   dla Solany „Klucz prywatny portfela”, dla Robinhood Chain i innych sieci EVM „Klucz prywatny portfela EVM”
   (64 znaki hex). Najlepiej użyj osobnego portfela tylko z kwotą przeznaczoną na bota.
3. Przy starcie sesji wybierz tryb Live i wpisz frazę potwierdzającą `HANDEL LIVE`.

Zanim użyjesz prawdziwych pieniędzy:

- **Koszty przy małym kapitale są wysokie.** Pierwszy zakup tokena tworzy konto tokena (rent ≈ 0,002 SOL), do tego prowizja
  platformy (~1% w każdą stronę), poślizg i opłaty sieci. Przy 1–2 USD kapitału sam rent to 10–20% kapitału —
  Ustawienia → Strategia pokazują szacunek kosztu pełnego cyklu dla Twoich kwot.
- Wykonanie live (quote → swap → podpis → potwierdzenie → odczyt faktycznych kwot z transakcji) jest zaimplementowane
  i pokryte testami podpisu, ale **nie było testowane na mainnecie** w tym projekcie. Zacznij od minimalnych kwot
  i sprawdź pierwsze transakcje w Solscan.
- Podpisywane są wyłącznie transakcje, w których płatnikiem i jedynym sygnatariuszem jest Twój portfel.
- **Sieci EVM:** przed podpisem sprawdzane są sieć, nadawca i dokładna kwota, a kontrakt docelowy (i ewentualny approve)
  musi być na allowliście sieci (domyślnie kontrakt LI.FI). Sprzedaż zatwierdza dokładnie sprzedawaną ilość tokena,
  nigdy nieograniczoną. Faktyczne kwoty i gaz są odczytywane z sald portfela przed i po bloku transakcji.
  Wykonanie EVM jest pokryte testami jednostkowymi i sprawdzone na prawdziwych wycenach LI.FI, ale **nie wysłano nim
  prawdziwej transakcji** — zacznij od minimalnych kwot. Bez klucza API LI.FI obowiązują limity zapytań (klucz można dodać w zakładce Konta).
- Publiczny RPC (`api.mainnet-beta.solana.com`) ma limity — do live użyj prywatnego RPC (URL zapisujesz jako sekret w zakładce Konta).
- Wynik live liczony jest od salda SOL portfela na starcie sesji — wpłaty/wypłaty w trakcie sesji zaburzą PNL.

## Wdrożenie na serwer (24/7)

> **Panel nie ma hasła**, więc odpowiada wyłącznie na połączenia z tego samego komputera (127.0.0.1 / localhost).
> Wystawienie go przez domenę, reverse proxy (Caddy) lub Dockera z publicznym portem **nie zadziała** — serwer odrzuci takie
> połączenia. Na serwerze zdalnym uruchom aplikację normalnie (systemd poniżej) i łącz się przez tunel SSH:
> `ssh -L 8787:127.0.0.1:8787 użytkownik@serwer`, a potem otwórz u siebie http://127.0.0.1:8787.

**Serwer (systemd):** `deploy/soldesk.service` (`Restart=always`, ograniczone uprawnienia), `HOST=127.0.0.1`, dostęp przez tunel SSH.
Skopiuj `.env.example` → `.env` i ustaw `MASTER_KEY` (kopię trzymaj poza serwerem).

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

- **Bez hasła:** kto ma dostęp do komputera z uruchomionym panelem, ma pełny dostęp do bota i portfela (w tym podglądu klucza).
  Dlatego serwer przyjmuje wyłącznie połączenia z 127.0.0.1 z adresem `localhost`/`127.0.0.1` (ochrona przed obcymi stronami
  podszywającymi się pod localhost — DNS rebinding), a zmiany stanu wymagają własnego nagłówka (ochrona CSRF).
  Nagłówki bezpieczeństwa: CSP, X-Frame-Options.
- Sekrety (klucz portfela, prywatny URL RPC) szyfrowane AES-256-GCM kluczem głównym spoza bazy; każdy podgląd jest
  odnotowywany w logu (bez wartości). Logi przechodzą redakcję kluczy i parametrów `api-key`.

## Rozbudowa

- Nowa strategia: funkcje `evaluateEntry` / `evaluateExit` w `server/src/engine/strategy.ts` (czyste funkcje, łatwe do testów).
- Nowe źródło danych: interfejs `MarketProvider` (`server/src/market/provider.ts`).
- Nowy sposób wykonania: interfejs `Executor` (`server/src/execution/executor.ts`).
- Nowa sieć EVM: wpis w Ustawienia → Sieci i połączenia (bez zmian w kodzie); logika sieci w `server/src/chains/chainRegistry.ts`.
- Nowe ustawienie: schemat w `server/src/config/schema.ts` + pole w odpowiednim formularzu panelu.
- Migracje bazy: dopisz kolejny element w `server/src/db/migrations.ts`.

## Ograniczenia

- Pozycje zamykane są w całości (brak częściowych wyjść).
- Pola z sufiksem `Sol` w kodzie i bazie oznaczają kwoty w walucie natywnej sieci sesji (SOL, ETH, BNB) — nazwy zostały
  zachowane dla zgodności danych; symbol waluty jest w `nativeSymbol`.
- Wykonanie live zależy od tras agregatora: na Solanie od Jupitera, na sieciach EVM od LI.FI. Tokeny, dla których
  agregator nie ma trasy (np. przed migracją z krzywej bondingowej do DEX), nie dostaną wyceny — zlecenie zakończy się błędem.
- Ceny z DexScreener mają ograniczoną precyzję (ok. 4 cyfry znaczące) — wpływa to na dokładność wyceny w trybie paper.
- Adres Jupiter API (`lite-api.jup.ag`) może się zmienić — da się go podmienić w Ustawienia → Sieci i połączenia.
