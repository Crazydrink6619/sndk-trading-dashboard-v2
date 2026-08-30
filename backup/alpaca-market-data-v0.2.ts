Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ALPACA_API_KEY")?.trim();
    const secretKey = Deno.env.get("ALPACA_SECRET_KEY")?.trim();

    if (!apiKey || !secretKey) {
      return new Response(
        JSON.stringify({
          error: "Alpaca API keys are missing",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const alpacaHeaders = {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
    };

    // SNDK 最新行情快照
    const snapshotUrl =
      "https://data.alpaca.markets/v2/stocks/SNDK/snapshot?feed=iex";

    // SNDK 5 分鐘 K 棒
    const start = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const barsUrl =
      `https://data.alpaca.markets/v2/stocks/SNDK/bars?timeframe=5Min&start=${encodeURIComponent(start)}&limit=100&feed=iex&sort=desc`;

    const [snapshotResponse, barsResponse] = await Promise.all([
      fetch(snapshotUrl, {
        method: "GET",
        headers: alpacaHeaders,
      }),
      fetch(barsUrl, {
        method: "GET",
        headers: alpacaHeaders,
      }),
    ]);

    if (!snapshotResponse.ok) {
      throw new Error(
        `Snapshot failed: HTTP ${snapshotResponse.status}`,
      );
    }

    if (!barsResponse.ok) {
      throw new Error(
        `5Min bars failed: HTTP ${barsResponse.status}`,
      );
    }

    const snapshot = await snapshotResponse.json();
    const barsData = await barsResponse.json();

    return new Response(
      JSON.stringify({
        symbol: "SNDK",
        feed: "iex",
        timeframe: "5Min",

        snapshot: snapshot,

        bars: barsData.bars ?? [],

        barCount: barsData.bars?.length ?? 0,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
