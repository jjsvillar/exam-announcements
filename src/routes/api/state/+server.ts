import { json, type RequestEvent } from '@sveltejs/kit';
import { updateState, usageState } from '$lib/server/state';

export async function POST({ request }: RequestEvent) {
    const data = await request.json();

    // Validate fields if necessary
    updateState(data);

    return json({ success: true, state: usageState });
}
