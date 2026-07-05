// src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// Đọc base URL từ biến môi trường
const AUTH_BACKEND_BASE_URL = process.env.AUTH_BACKEND_BASE_URL;

export async function POST(request: Request) {
  try {
    if (!AUTH_BACKEND_BASE_URL) {
      return NextResponse.json(
        { result: -1, data: 'Missing AUTH_BACKEND_BASE_URL env variable' },
        { status: 500 }
      );
    }

    // Nối path cụ thể
    const BACKEND_URL = `${AUTH_BACKEND_BASE_URL}/api/HVTT/HPT/Authencation/clientAuthenticate`;

    // Đọc body từ client
    const body = await request.json();

    // Mã hoá password thành MD5 giống script Postman
    if (body.Password && typeof body.Password === 'string') {
      const md5 = crypto.createHash('md5').update(body.Password).digest('hex');
      body.Password = md5;
    }

    // Gọi lên backend với password đã MD5
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { result: -1, data: err.message || 'Proxy error' },
      { status: 500 }
    );
  }
}
