import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { rateLimit, RATE_LIMIT_TIERS } from '@/lib/rate-limit';

const createStoreSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.moderate);
    if (limited) return limited;

    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stores = await prisma.store.findMany({
      where: { accountId: session.user.accountId },
    });

    return NextResponse.json(stores);
  } catch (error) {
    console.error('Get stores error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.moderate);
    if (limited) return limited;

    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.user.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can create stores' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const validatedData = createStoreSchema.parse(body);

    const store = await prisma.store.create({
      data: {
        ...validatedData,
        ownerId: session.user.id,
        accountId: session.user.accountId,
      },
    });

    return NextResponse.json(store, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error }, { status: 400 });
    }

    console.error('Create store error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
