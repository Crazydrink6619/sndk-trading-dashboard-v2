Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  try {
    const apiKey = Deno.env.get("ALPACA_API_KEY")?.trim();
    const secretKey = Deno.env.get("ALPACA_SECRET_KEY")?.trim();

    if (!apiKey || !secretKey) {
      return json(
        {
          ok: false,
          stage: "credentials",
          error: "Alpaca API keys are missing",
        },
        500,
      );
    }

    const alpacaHeaders = {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
    };

    const symbol = "SNDK";

    // 抓最近 7 天，避免週末測試時沒有資料
    const start = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const snapshotUrl =
      `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot?feed=iex`;

    const bars1MinUrl =
      `https://data.alpaca.markets/v2/stocks/${symbol}/bars` +
      `?timeframe=1Min` +
      `&start=${encodeURIComponent(start)}` +
      `&limit=100` +
      `&feed=iex` +
      `&sort=desc`;

    const bars5MinUrl =
      `https://data.alpaca.markets/v2/stocks/${symbol}/bars` +
      `?timeframe=5Min` +
      `&start=${encodeURIComponent(start)}` +
      `&limit=100` +
      `&feed=iex` +
      `&sort=desc`;

    // 三個請求一起跑，速度比較快
    const [snapshotResponse, bars1MinResponse, bars5MinResponse] =
      await Promise.all([
        fetch(snapshotUrl, { headers: alpacaHeaders }),
        fetch(bars1MinUrl, { headers: alpacaHeaders }),
        fetch(bars5MinUrl, { headers: alpacaHeaders }),
      ]);

    if (!snapshotResponse.ok) {
      const errorText = await snapshotResponse.text();

      return json(
        {
          ok: false,
          stage: "snapshot",
          status: snapshotResponse.status,
          error: errorText,
        },
        snapshotResponse.status,
      );
    }

    if (!bars1MinResponse.ok) {
      const errorText = await bars1MinResponse.text();

      return json(
        {
          ok: false,
          stage: "1Min",
          status: bars1MinResponse.status,
          error: errorText,
        },
        bars1MinResponse.status,
      );
    }

    if (!bars5MinResponse.ok) {
      const errorText = await bars5MinResponse.text();

      return json(
        {
          ok: false,
          stage: "5Min",
          status: bars5MinResponse.status,
          error: errorText,
        },
        bars5MinResponse.status,
      );
    }

    const snapshot = await snapshotResponse.json();
    const bars1MinData = await bars1MinResponse.json();
    const bars5MinData = await bars5MinResponse.json();

    // Alpaca 回傳 desc，所以轉成舊 → 新
    const bars1Min = [...(bars1MinData.bars ?? [])].reverse();
    const bars5Min = [...(bars5MinData.bars ?? [])].reverse();

    return json({
      ok: true,

      version: "0.4",

      symbol,

      feed: "iex",

      snapshot,

      timeframes: {
        "1Min": {
          barCount: bars1Min.length,
          bars: bars1Min,
        },

        "5Min": {
          barCount: bars5Min.length,
          bars: bars5Min,
        },
      },

      latest: {
        "1Min": bars1Min.at(-1) ?? null,
        "5Min": bars5Min.at(-1) ?? null,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "unexpected",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        stack:
          error instanceof Error
            ? error.stack
            : null,
      },
      500,
    );
  }
});
