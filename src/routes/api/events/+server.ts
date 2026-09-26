import { usageState, stateEmitter } from '$lib/server/state';

export function GET() {
    let listener: (data: any) => void;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const send = (data: any) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            // Send initial state
            send(usageState);

            listener = (data) => {
                send(data);
            };

            stateEmitter.on('update', listener);
        },
        cancel() {
            if (listener) {
                stateEmitter.off('update', listener);
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
