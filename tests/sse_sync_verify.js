import assert from 'node:assert/strict';

const baseUrl = process.env.EXAM_APP_URL ?? 'http://127.0.0.1:5173';
const controllers = Array.from({ length: 3 }, () => new AbortController());

/** @param {AbortController} controller */
async function connect(controller) {
    const response = await fetch(`${baseUrl}/api/events`, {
        signal: controller.signal
    });
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return async function readState() {
        while (!buffer.includes('\n\n')) {
            const { value, done } = await reader.read();
            assert.equal(done, false, 'event stream closed unexpectedly');
            buffer += decoder.decode(value, { stream: true });
        }

        const boundary = buffer.indexOf('\n\n');
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return JSON.parse(event.replace(/^data:\s*/, ''));
    };
}

try {
    const clients = await Promise.all(controllers.map(connect));
    const initialStates = await Promise.all(clients.map((readState) => readState()));
    const expectedState = initialStates[0];

    const updateResponse = await fetch(`${baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expectedState)
    });
    assert.equal(updateResponse.status, 200);

    const updatedStates = await Promise.all(clients.map((readState) => readState()));
    for (const state of updatedStates) {
        assert.deepEqual(state, expectedState);
    }

    console.log('SSE synchronization test passed for three concurrent clients.');
} finally {
    for (const controller of controllers) controller.abort();
}
