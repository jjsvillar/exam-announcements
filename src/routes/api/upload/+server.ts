import { json } from '@sveltejs/kit';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

export async function POST({ request }) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const extension = file.name.split('.').pop();
        const filename = `${randomUUID()}.${extension}`;

        // Ensure uploads directory exists (you might want to check/create this on startup)
        const uploadDir = join(process.cwd(), 'uploads');
        await mkdir(uploadDir, { recursive: true });
        const uploadPath = join(uploadDir, filename);

        await writeFile(uploadPath, Buffer.from(buffer));

        return json({
            success: true,
            url: `/uploads/${filename}`
        });
    } catch (e) {
        console.error("Upload error:", e);
        return json({ error: 'Upload failed' }, { status: 500 });
    }
}
