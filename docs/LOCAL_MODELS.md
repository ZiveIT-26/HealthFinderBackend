[← Back to README](../README.md)

# Local models

The project runs on the OpenAI API. A local model is only for testing on your own machine: free, works offline, and shows where the prompts are too weak.

This guide uses [Ollama](https://ollama.com). Any server with an OpenAI-compatible API works the same way.

## 1. Install Ollama

Download it from https://ollama.com/download and install. It runs in the background on `http://localhost:11434`.

Check:

```powershell
ollama --version
```

## 2. Pick a model

Browse https://ollama.com/search. The model must:

- **support tools.** The agent calls tools (doctor search, memory). Filter the search by "Tools". Without it, the first message fails with an error like "does not support tools".
- **fit your GPU.** The download size plus about 1–2 GB for the context should be less than your VRAM. With 6 GB, take models up to about 4 GB. Bigger ones still run, but partly on the CPU and much slower.
- **be an instruct/chat model**, not a "base" or "embedding" one.

Smaller models (around 4B parameters) are fast but make more mistakes with tools. Around 8–9B is a good balance if it fits.

Download it:

```powershell
ollama pull <model>
```

`<model>` is the name from the Ollama site, e.g. `name:tag`.

## 3. Give it a bigger context window

Ollama's default context is too small for the agent's prompt, so the model would forget the start of the conversation. Make a copy of the model with a bigger one.

Create a file named `Modelfile` (no extension), anywhere:

```
FROM <model>
PARAMETER num_ctx 16384
```

Then, in the same folder:

```powershell
ollama create <model>-16k -f Modelfile
```

`<model>-16k` is just a name you choose. Putting the context size in it helps you remember. `ollama list` should now show it.

`16384` (16k) is enough for longer chats. If the model doesn't fit your GPU (see step 6), use `8192`.

## 4. Point the backend at it

In `.env`:

```
OPENAI_API_KEY=
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=<model>
LLM_REASONING_EFFORT=none
```

**`OPENAI_API_KEY` must be empty.** If it is set, the backend uses OpenAI and ignores everything else here.

`LLM_REASONING_EFFORT=none` turns "thinking" off for models that have it. Leave it off: thinking is slow, and some models mix it into the answer.

To switch back to OpenAI, put your key back into `OPENAI_API_KEY`.

## 5. Run

```powershell
npm run chat
```

The first message is slow because the model is loading into memory. Later ones are faster.

## 6. Check it runs on the GPU

While a message is processing, or right after:

```powershell
ollama ps
```

The `PROCESSOR` column should show `100% GPU`. If it shows something like `30%/70% CPU/GPU`, the model doesn't fit and answers will be several times slower. Recreate it with `num_ctx 8192` (step 3) or pick a smaller model.

## Optional: a different model for triage

Triage (deciding how urgent a message is) can use its own model, for example a smaller and faster one:

```
LLM_TRIAGE_MODEL=<another model>
```

Leave it empty to use `LLM_MODEL` for everything. Compare models on the triage test cases with:

```powershell
npm run eval:triage
```

## No GPU?

It still works on the CPU, just slowly. \
A shared Ollama server is another option: welp... lend one somewhere... or try asking mikie

## Good to know

- Ollama handles one request at a time by default, so triage, the answer and the chat title run one after another.
- Small models break the expected output format more often than gpt-4o. If an answer looks wrong, try the same message with OpenAI before debugging the code.
- `ollama list` shows your models, `ollama rm <name>` deletes one.
