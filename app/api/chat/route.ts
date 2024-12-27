import { NextRequest } from 'next/server';
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

const INPUT_TOKEN_COST = 3; // Cost per 1,000,000 input tokens
const OUTPUT_TOKEN_COST = 15; // Cost per 1,000,000 output tokens

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const anthropicMessages = body.messages.map((msg: any) => ({
      role: msg.role,
      content: [{ type: "text", text: msg.content }],
    }));

    const stream = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 3000,
      temperature: 0,
      messages: anthropicMessages,
      stream: true,
    });

    const encoder = new TextEncoder();
    const customReadable = new ReadableStream({
      async start(controller) {
        try {
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk.delta.text)}\n\n`)
              );
            }
            
            if (chunk.usage) {
              totalInputTokens = chunk.usage.input_tokens;
              totalOutputTokens = chunk.usage.output_tokens;
            }
          }

          const inputCost = (totalInputTokens / 1_000_000) * INPUT_TOKEN_COST;
          const outputCost = (totalOutputTokens / 1_000_000) * OUTPUT_TOKEN_COST;

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                inputCost: inputCost.toFixed(6),
                outputCost: outputCost.toFixed(6),
              })}\n\n`
            )
          );

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(customReadable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }), 
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}