import { error } from '@sveltejs/kit';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

export async function GET({ params }) {
    const { filename } = params;
    // Security check: ensure no directory traversal
    if (filename.includes('..') || filename.includes('/')) {
        throw error(400, 'Invalid filename');
    }

    const filePath = join(process.cwd(), 'uploads', filename);

    try {
        await access(filePath, constants.R_OK);
        const fileBuffer = await readFile(filePath);

        const ext = filename.split('.').pop()?.toLowerCase();
        let contentType = 'application/octet-stream';

        switch (ext) {
            case 'mp4': contentType = 'video/mp4'; break;
            case 'mp3': contentType = 'audio/mpeg'; break;
            case 'wav': contentType = 'audio/wav'; break;
            case 'ogg': contentType = 'audio/ogg'; break;
            case 'png': contentType = 'image/png'; break;
            case 'jpg':
            case 'jpeg': contentType = 'image/jpeg'; break;
            case 'gif': contentType = 'image/gif'; break;
            case 'svg': contentType = 'image/svg+xml'; break;
        }

        return new Response(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch {
        throw error(404, 'File not found');
    }
}
