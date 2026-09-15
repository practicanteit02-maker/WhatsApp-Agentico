import { NextResponse } from 'next/server';
import {
  configurationErrorResponse,
  getAvailablePhoneNumbers
} from '@/lib/inbox-settings';
import { requierePermiso } from '@/lib/require-permission';

export async function GET(request: Request) {
  try {
    const denegado = await requierePermiso('leer');
    if (denegado) return denegado;

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('refresh') === 'true';
    const phoneNumbers = await getAvailablePhoneNumbers({ force });

    return NextResponse.json({
      data: phoneNumbers
    });
  } catch (error) {
    console.error('Error fetching phone numbers:', error);
    return configurationErrorResponse(error);
  }
}
