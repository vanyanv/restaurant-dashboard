import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createStoreSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stores =
      session.user.role === 'OWNER'
        ? await prisma.store.findMany({
            where: { ownerId: session.user.id },
            include: {
              _count: {
                select: {
                  managers: true,
                  reports: true,
                },
              },
            },
          })
        : await prisma.store.findMany({
            where: {
              managers: {
                some: {
                  managerId: session.user.id,
                  isActive: true,
                },
              },
            },
            include: {
              _count: {
                select: {
                  reports: true,
                },
              },
            },
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
