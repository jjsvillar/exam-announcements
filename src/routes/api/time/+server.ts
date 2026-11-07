import { json } from '@sveltejs/kit';

export function GET() {
    return json(
        { timestamp: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
