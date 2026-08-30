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
          keyPresent: !!apiKey,
          secretPresent: !!secretKey,
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

    const url =
      "https://data.alpaca.markets/v2/stocks/SNDK/snapshot?feed=iex";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secretKey,
      },
    });

    const text = await response.text();

    return new Response(
      JSON.stringify({
        status: response.status,
        body: text,
        keyPresent: true,
        secretPresent: true,
        keyLength: apiKey.length,
        secretLength: secretKey.length,
      }),
      {
        status: response.status,
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
