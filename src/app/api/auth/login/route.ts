import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/lib/auth';
import { clientIp, rateLimit, waitText } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    // Slow down password guessing: per address and per account (generous, so real users are not locked out).
    const byIp = rateLimit(`login-ip:${clientIp(request.headers)}`, 15, 900_000);
    const byEmail = rateLimit(`login-email:${email.trim().toLowerCase()}`, 20, 900_000);
    if (!byIp.ok || !byEmail.ok) {
      const wait = Math.max(!byIp.ok ? byIp.retryAfterSeconds : 0, !byEmail.ok ? byEmail.retryAfterSeconds : 0);
      return NextResponse.json({ error: `Too many sign-in attempts. Try again in ${waitText(wait)}.` }, { status: 429 });
    }
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    }
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not sign in.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
