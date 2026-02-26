// OpenAI-backed chat service (used instead of Gemini in the UI)
// Exports the same symbols as the old Gemini service:
//   - CODE_KEYWORDS
//   - streamChat(history, newMessage, imageParts, useCodeExecution, userInfo)
//   - chatWithCsvTools(history, newMessage, csvHeaders, executeFn, userInfo)

// Use only OpenAI key; no fallback to Gemini so we never send the wrong key.
const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.REACT_APP_OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_BASE_URL = process.env.REACT_APP_OPENAI_BASE_URL || 'https://api.openai.com/v1';

export const CODE_KEYWORDS =
  /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

let cachedPrompt = null;

async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    const res = await fetch('/prompt_chat.txt');
    cachedPrompt = res.ok ? (await res.text()).trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

function buildSystemInstruction(baseInstruction, history, userInfo) {
  let systemInstruction = baseInstruction || '';
  if (userInfo && (userInfo.firstName || userInfo.lastName || userInfo.username)) {
    const fullName = [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ');
    const displayName = fullName || userInfo.username;
    const identityLine = `The user's name is ${displayName}${
      userInfo.username && userInfo.username !== displayName ? ` (username: ${userInfo.username})` : ''
    }.`;
    const greetingLine =
      !history?.length && userInfo.firstName
        ? `Greet them by first name in your first message (e.g. "Hi ${userInfo.firstName} — …" or "Hi ${userInfo.firstName}, …").`
        : '';
    const extra = `\n\nUSER IDENTITY AND GREETING RULES:\n${identityLine}${
      greetingLine ? `\n${greetingLine}` : ''
    }`;
    systemInstruction = (systemInstruction + extra).trim();
  }
  return systemInstruction;
}

async function callOpenAIChat({
  history,
  newMessage,
  userInfo,
  imageParts,
  csvHeaders,
}) {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'Missing OpenAI API key. Add REACT_APP_OPENAI_API_KEY=sk-... to your .env in the project root, ' +
      'then stop the dev server (Ctrl+C) and run "npm start" again so the key is loaded.'
    );
  }

  const baseInstruction = await loadSystemPrompt();
  const systemInstruction = buildSystemInstruction(baseInstruction, history, userInfo);

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  const baseHistory = (history || []).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content || '',
  }));
  messages.push(...baseHistory);

  const msgWithContext =
    csvHeaders && csvHeaders.length
      ? `[CSV columns: ${csvHeaders.join(', ')}]\n\n${newMessage}`
      : newMessage;

  if (imageParts && imageParts.length) {
    const content = [
      { type: 'text', text: msgWithContext },
      ...imageParts.map((img) => ({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType || 'image/png'};base64,${img.data}`,
        },
      })),
    ];
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: msgWithContext });
  }

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { text };
}

// useCodeExecution is currently ignored in the OpenAI path; all requests use
// standard chat completions. The generator still yields at least one text chunk
// so the UI keeps working.
export const streamChat = async function* (
  history,
  newMessage,
  imageParts = [],
  useCodeExecution = false, // kept for API compatibility
  userInfo
) {
  const { text } = await callOpenAIChat({
    history,
    newMessage,
    userInfo,
    imageParts,
    csvHeaders: null,
  });
  if (text) {
    yield { type: 'text', text };
  }
};

// CSV-aware chat path. For now this uses the same OpenAI chat completions API
// without explicit function-calling tools. The CSV context (column list,
// summary, slim CSV) is still provided in the prompt assembled in Chat.js, so
// the model can reason about the data directly. Tool charts and logs are
// returned empty to keep the rest of the UI working.
export const chatWithCsvTools = async (
  history,
  newMessage,
  csvHeaders,
  executeFn, // kept for API compatibility, currently unused
  userInfo
) => {
  const { text } = await callOpenAIChat({
    history,
    newMessage,
    userInfo,
    imageParts: null,
    csvHeaders,
  });
  return { text, charts: [], toolCalls: [] };
};

