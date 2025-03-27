"use client";

import Image from 'next/image';
import Link from 'next/link';
import { Button } from './ui/button';
import { useEffect, useRef } from 'react';

const HeroSection = () => {

    const imageRef = useRef()

    useEffect(() => {
        const imageElement = imageRef.current;
        const handlescroll = () => {
            const scrollPosition = window.scrollY;
            const scrollThreshold = 100;

            if(scrollPosition>scrollThreshold){
            imageElement.classList.add("scrolled");
        } else {
            imageElement.classList.remove("scrolled");
            }
        };
            window.addEventListener('scroll', handlescroll);
            return () => {
                window.removeEventListener('scroll', handlescroll);
            }
        }, [])
    
  return (
    <div className="pb-20 px-4">
        <div className='container mx-auto text-center'>
            <h1 className='text-5xl md:text-8xl lg:text-[105px] pb-6 gradient-title'>Master Your Finances <br />With Smart and Intelligence
            </h1>
            <p className='text-xl text-gray-600 mb-8 max-w-2xl mx-auto'>An AI-powered financial platform that helps you easily track, understand, and improve your spending with real-time insights, so you can make smarter financial choices every day.</p>
        <div className='flex justify-center space-x-4'>
           <Link href="/dashboard">
           <Button size="lg" className='px-8'>
            Get Started
            </Button>
           </Link>

        </div>
        <div className="hero-image-wrap">
            <div ref={imageRef} className='hero-image'>
                <Image 
                src="/banner.jpeg"
                width={1280}
                height={720}
                alt='Dashboard'
                className='rounded-lg shadow-2xl border mx-auto'
                priority
                />
            </div>
        </div>
        </div>
    </div>
  )
}

export default HeroSection