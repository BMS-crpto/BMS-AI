import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      password.length < 10
    ) {
      return NextResponse.json(
        { error: 'Enter a valid email and a password of at least 10 characters.' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
      },
    });

    await createSession(user.id);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    console.error('Registration error:', error);

    return NextResponse.json(
      { error: 'Could not create your account. Please try again.' },
      { status: 500 }
    );
  }
}
