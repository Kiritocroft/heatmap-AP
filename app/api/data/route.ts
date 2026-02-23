import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
  try {
    const connection = await pool.getConnection();

    try {
      // Ensure table exists
      await connection.query(`
        CREATE TABLE IF NOT EXISTS app_storage (
          storage_key VARCHAR(255) PRIMARY KEY,
          storage_value LONGTEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      const [rows] = await connection.query<RowDataPacket[]>('SELECT storage_key, storage_value FROM app_storage');
      
      const data: Record<string, any> = {};
      rows.forEach((row) => {
        try {
          data[row.storage_key] = JSON.parse(row.storage_value);
        } catch (e) {
          // If parsing fails, use raw string (though we always stringify on save)
          data[row.storage_key] = row.storage_value;
        }
      });

      return NextResponse.json(data);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Ensure table exists
      await connection.query(`
        CREATE TABLE IF NOT EXISTS app_storage (
          storage_key VARCHAR(255) PRIMARY KEY,
          storage_value LONGTEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      for (const [key, value] of Object.entries(body)) {
        // Always stringify to ensure consistent storage format (JSON string)
        // If value is already a string, it becomes a quoted string.
        // If value is an object, it becomes a JSON representation.
        const stringValue = JSON.stringify(value);
        
        await connection.query(`
          INSERT INTO app_storage (storage_key, storage_value)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE storage_value = ?
        `, [key, stringValue, stringValue]);
      }

      await connection.commit();
      return NextResponse.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
