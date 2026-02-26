// OpenAI-backed chat service (used instead of Gemini in the UI)
// Exports the same symbols as the old Gemini service:
//   - CODE_KEYWORDS
//   - streamChat(history, newMessage, imageParts, useCodeExecution, userInfo)
//   - chatWithCsvTools(history, newMessage, csvHeaders, executeFn, userInfo)
//   - chatWithAssistantTools(history, newMessage, userInfo, options) — 4 tools: generateImage, plot_metric_vs_time, play_video, compute_stats_json

// Use only OpenAI key; no fallback to Gemini so we never send the wrong key.
const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.REACT_APP_OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_BASE_URL = process.env.REACT_APP_OPENAI_BASE_URL || 'https://api.openai.com/v1';

export const CODE_KEYWORDS =
  /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

// ── Tool registry (exact names: generateImage, plot_metric_vs_time, play_video, compute_stats_json) ──
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'generateImage',
      description: 'Generate an image from a text prompt. Use when the user asks for an image, thumbnail, illustration, or visual. If the user attached an image in this message, pass anchorImage: "use_attached" to use it as reference for style/content.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the image to generate (e.g. "a thumbnail variant with bold text")' },
          anchorImage: {
            type: 'string',
            description: 'Optional. Use "use_attached" to use the image the user dragged into this message as a reference. Omit for prompt-only generation.',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plot_metric_vs_time',
      description: 'Plot a numeric field from the loaded YouTube channel data over time (x-axis: release_date). Use when the user asks for a time-series or trend chart (e.g. "plot view_count vs time").',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Numeric field to plot on y-axis (e.g. view_count, like_count, comment_count, duration)' },
          sort: { type: 'string', enum: ['asc', 'desc'], description: 'Sort by release_date: asc (oldest first) or desc (newest first). Default asc.' },
        },
        required: ['field'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_video',
      description: 'Select and open a video from the loaded YouTube channel JSON. Use when the user says "play most viewed", "play the first video", "play the N-th video", or "play the [title] video" (e.g. "play the asbestos video").',
      parameters: {
        type: 'object',
        properties: {
          queryType: {
            type: 'string',
            enum: ['most_viewed', 'ordinal', 'title'],
            description: 'How to select the video: most_viewed (max view_count), ordinal (nth by newest-first release_date), or title (case-insensitive title contains).',
          },
          titleContains: { type: 'string', description: 'For queryType "title": substring to match in video title (case-insensitive).' },
          ordinal: { type: 'integer', description: 'For queryType "ordinal": 1 = newest by release_date, 2 = second newest, etc.' },
        },
        required: ['queryType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compute_stats_json',
      description: 'Compute summary statistics (count, mean, median, std, min, max) for a numeric field in the currently loaded YouTube channel JSON. Use when the user asks for stats, summary, or distribution of a metric (e.g. view_count, like_count, duration).',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Numeric field name in the loaded channel JSON (e.g. view_count, like_count, comment_count, duration)' },
        },
        required: ['field'],
      },
    },
  },
];

async function callOpenAIImages(prompt, useAnchorImage, attachedImages) {
  const effectivePrompt =
    useAnchorImage && attachedImages?.length
      ? `Using the user's attached image as reference. Create an image that: ${prompt}`
      : prompt;
  const res = await fetch(`${OPENAI_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-2',
      prompt: effectivePrompt.slice(0, 1000),
      n: 1,
      size: '512x512',
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Images API error: ${res.status}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data in response');
  return `data:image/png;base64,${b64}`;
}

async function executeToolHandler(name, args, context = {}) {
  const { channelData, attachedImages } = context;
  const videos = channelData?.videos || [];
  switch (name) {
    case 'generateImage': {
      const prompt = (args?.prompt ?? '').trim();
      if (!prompt) {
        return { _toolType: 'generateImage', error: 'Missing required parameter: prompt' };
      }
      const useAnchor = args?.anchorImage === 'use_attached';
      try {
        const imageDataUrl = await callOpenAIImages(prompt, useAnchor, attachedImages);
        return { _toolType: 'generateImage', imageDataUrl, prompt };
      } catch (e) {
        const msg = e.message || String(e);
        return {
          _toolType: 'generateImage',
          error: msg.includes('rate_limit') || msg.includes('insufficient_quota')
            ? 'Image generation limit or quota exceeded. Try again later.'
            : msg.slice(0, 200),
          prompt,
        };
      }
    }
    case 'plot_metric_vs_time': {
      const field = typeof args?.field === 'string' ? args.field.trim() : '';
      if (!field) {
        return { _toolType: 'plot_metric_vs_time', error: 'Missing required parameter: field' };
      }
      if (!channelData?.videos?.length) {
        return { _toolType: 'plot_metric_vs_time', error: 'No channel data loaded. Load a YouTube channel JSON file first.' };
      }
      const sortOrder = args?.sort === 'desc' ? 'desc' : 'asc';
      const rows = videos
        .filter((v) => {
          const rd = v.release_date;
          const val = v[field];
          return rd != null && String(rd).trim() !== '' && typeof val === 'number' && Number.isFinite(val);
        })
        .map((v) => ({ release_date: v.release_date, [field]: v[field] }));
      if (rows.length === 0) {
        return {
          _toolType: 'plot_metric_vs_time',
          error: `No valid data: field "${field}" or release_date missing/non-numeric.`,
        };
      }
      rows.sort((a, b) => {
        const d = String(a.release_date).localeCompare(String(b.release_date));
        return sortOrder === 'desc' ? -d : d;
      });
      return { _toolType: 'plot_metric_vs_time', field, sort: sortOrder, data: rows };
    }
    case 'play_video': {
      const queryType = args?.queryType === 'most_viewed' || args?.queryType === 'ordinal' || args?.queryType === 'title' ? args.queryType : '';
      if (!queryType) {
        return { _toolType: 'play_video', error: 'Missing or invalid queryType. Use "most_viewed", "ordinal", or "title".' };
      }
      if (!channelData?.videos?.length) {
        return { _toolType: 'play_video', error: 'No channel data loaded. Load a YouTube channel JSON file first.' };
      }
      const list = [...videos];
      let selected = null;
      let closeMatches = [];
      if (queryType === 'most_viewed') {
        const withViews = list.filter((v) => typeof v.view_count === 'number' && Number.isFinite(v.view_count));
        if (withViews.length === 0) {
          return { _toolType: 'play_video', error: 'No videos with view_count in channel data.' };
        }
        selected = withViews.reduce((best, v) => (v.view_count > best.view_count ? v : best));
      } else if (queryType === 'ordinal') {
        const n = Math.floor(Number(args?.ordinal)) || 1;
        const byNewest = list.filter((v) => v.release_date != null).sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
        if (byNewest.length === 0) {
          return { _toolType: 'play_video', error: 'No videos with release_date in channel data.' };
        }
        const index = Math.max(0, n - 1);
        selected = byNewest[index] ?? byNewest[0];
      } else if (queryType === 'title') {
        const needle = (args?.titleContains ?? '').trim().toLowerCase();
        if (!needle) {
          return { _toolType: 'play_video', error: 'For queryType "title", titleContains is required.' };
        }
        const matches = list.filter((v) => (v.title && String(v.title).toLowerCase().includes(needle)));
        if (matches.length === 0) {
          return { _toolType: 'play_video', error: `No video title contains "${args.titleContains}".` };
        }
        matches.sort((a, b) => (String(a.title).length - String(b.title).length));
        selected = matches[0];
        closeMatches = matches.slice(1, 6).map((v) => ({ title: v.title, video_url: v.video_url }));
      }
      if (!selected?.video_url) {
        return { _toolType: 'play_video', error: 'Selected video has no video_url.' };
      }
      return {
        _toolType: 'play_video',
        video_url: selected.video_url,
        title: selected.title ?? '',
        thumbnail_url: selected.thumbnail_url ?? '',
        view_count: selected.view_count,
        like_count: selected.like_count,
        release_date: selected.release_date,
        closeMatches: closeMatches.length ? closeMatches : undefined,
      };
    }
    case 'compute_stats_json': {
      const field = typeof args?.field === 'string' ? args.field.trim() : '';
      if (!field) {
        return { _toolType: 'compute_stats_json', error: 'Missing required parameter: field' };
      }
      if (!channelData?.videos?.length) {
        return { _toolType: 'compute_stats_json', error: 'No channel data loaded. Load a YouTube channel JSON file first.' };
      }
      const numbers = videos
        .map((v) => v[field])
        .filter((n) => n != null && typeof n === 'number' && Number.isFinite(n));
      if (numbers.length === 0) {
        return {
          _toolType: 'compute_stats_json',
          error: `Field "${field}" has no numeric values or does not exist in the loaded channel data.`,
        };
      }
      const sorted = [...numbers].sort((a, b) => a - b);
      const n = numbers.length;
      const sum = numbers.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const median = n % 2 === 1
        ? sorted[(n - 1) / 2]
        : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const variance = n > 1
        ? numbers.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1)
        : 0;
      const std = Math.sqrt(variance);
      return {
        _toolType: 'compute_stats_json',
        field,
        count: n,
        mean: Math.round(mean * 1e6) / 1e6,
        median: Math.round(median * 1e6) / 1e6,
        std: Math.round(std * 1e6) / 1e6,
        min: sorted[0],
        max: sorted[sorted.length - 1],
      };
    }
    default:
      return { _toolType: 'unknown', error: `Unknown tool: ${name}` };
  }
}

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

/** Chat with assistant tools: send tools to the model, execute tool_calls, loop until final text. Returns { text, toolCalls }. */
async function callOpenAIChatWithTools({
  history,
  newMessage,
  userInfo,
  imageParts,
  channelData,
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
  if (imageParts?.length) {
    const content = [
      { type: 'text', text: newMessage },
      ...imageParts.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.data}` },
      })),
    ];
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: newMessage });
  }

  const toolCallsLog = [];
  const context = {
    channelData: channelData || null,
    attachedImages: imageParts && imageParts.length ? imageParts : [],
  };
  let lastResponse = null;
  let iterations = 0;
  const maxToolRounds = 5;

  while (iterations < maxToolRounds) {
    const body = {
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    };
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${errText}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice?.message) {
      break;
    }
    lastResponse = choice.message;
    const msg = lastResponse;

    if (msg.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' },
        })),
      });
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch (_) {}
        const result = await executeToolHandler(name, args, context);
        toolCallsLog.push({ id: tc.id, name, args, result });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      iterations++;
      continue;
    }
    break;
  }

  const text = lastResponse?.content ?? '';
  return { text, toolCalls: toolCallsLog };
}

export const chatWithAssistantTools = async (
  history,
  newMessage,
  userInfo,
  options = {}
) => {
  const { channelData = null, imageParts = null } = options;
  return callOpenAIChatWithTools({
    history,
    newMessage,
    userInfo,
    imageParts,
    channelData,
  });
};

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

