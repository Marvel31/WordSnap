# WordSnap

WordSnap is a v1 Expo mobile app for extracting English text from a book photo, saving level-matched words with Korean meanings, and reviewing them with flashcards.

## Run

```bash
npm install
npm start
```

Open the project in Expo Go from a phone on the same Wi-Fi network.

## v1 Features

- Take a book photo or choose an image
- Extract English text with OCR.Space
- Review and edit OCR text before building save candidates
- Extract save candidates directly with Gemini from the OCR text
- Select the target Level in Settings
- Create vocabulary lists by book title when saving candidates
- Filter vocabulary by book title
- Study flashcards by selected book
- Home screen with total, unmemorized, and memorized word counts
- Folder creation modal with 20-character name limit
- Folder settings screen for creating, renaming, deleting, and reordering folders
- Book detail screen with sort, memorization filter, word/meaning hide modes, move, mark-known, delete, and device TTS
- Save words by difficulty level
- Review word candidates before saving
- Select all or deselect all candidate words
- Exclude duplicate words that are already saved
- View saved vocabulary
- Multi-select saved vocabulary entries
- Select all visible vocabulary entries and delete them
- Delete saved vocabulary entries
- Review saved words with flashcards
- Store Level and vocabulary locally

## Levels

- `Level 1`: default, saves almost every readable non-stop word
- `Level 2`: elementary upper grades and above
- `Level 3`: middle school level and above
- `Level 4`: high school level and above
- `Level 5`: advanced high school senior level

## OCR.Space Setup

This app uses OCR.Space for OCR during v1 development because it supports API-key based REST calls from Expo Go.

Create a local `.env` file from `.env.example` and add your API key:

```bash
OCR_SPACE_API_KEY=YOUR_OCR_SPACE_API_KEY
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
```

Then restart Expo:

```bash
npx expo start --host lan --clear
```

If the key is empty, you can still paste English text into the OCR text box and test the word extraction flow.

## Gemini Setup

Gemini is used on the review screen to fill or improve Korean meanings, parts of speech, examples, and difficulty levels for selected candidate words.

Add your Gemini API key in the same local `.env` file:

```bash
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Then restart Expo:

```bash
npx expo start --host lan --clear
```

For production, do not ship API keys inside the mobile app. Move Gemini calls behind your own backend before release.

## Note About ML Kit

Google ML Kit Text Recognition is an on-device native SDK and does not use an API key for OCR calls. To use ML Kit directly in this Expo project, you would need a custom development build with a native ML Kit React Native module. For the current v1 and Expo Go testing, OCR.Space is the simpler API-key based path.
