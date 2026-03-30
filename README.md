# FinSight

## Overview
FinSight is a finance workspace that helps founders and operators turn raw company data into clear decisions.  
It brings valuation, credit analysis, budgeting, scenario planning, and advisory-style insights into one product.

## Inspiration
I wanted to make startup finance feel less messy and more usable.  
A lot of teams have numbers everywhere, but no simple way to turn them into investor-ready insight.

## What it does
FinSight lets users build a company profile, import financial data, run DCF and credit analysis, and save scenarios.  
The goal is to make finance workflows faster, clearer, and easier to present.

## How I built it
I built the frontend as a polished web app and connected it to a Cloudflare Worker backend.  
For persistence and backend logic, I used Cloudflare D1 along with custom finance analysis endpoints.

## Challenges
The hardest part was getting deployment, backend routing, and model integration working under time pressure.  
Another challenge was making the app feel like a real product instead of just a finance calculator.

## What I learned
I learned a lot about shipping quickly, especially around deployment flow, backend reliability, and product polish.  
I also learned that a strong demo and clear story matter just as much as technical depth.

## Features
- Company profile workspace
- Financial CSV import
- DCF / NPV analysis
- Credit risk analysis
- Budget builder
- Scenario saving and loading
- Persistent backend storage

## Tech Stack
JavaScript, HTML, CSS, Cloudflare Workers, Cloudflare D1, REST APIs, GitHub, and GitHub Pages.

## Repo Setup
The frontend is hosted with GitHub Pages and the backend is deployed with Cloudflare Workers.  
Secrets are stored in Cloudflare Worker secrets and are not included in this repository.

## Live Demo 
Backend: https://finsight-worker.goatsatcoding.workers.dev/

## Submission Notes
This project was built as a hackathon-ready finance platform with an emphasis on usability and presentation.  
It is designed to show how raw business metrics can become boardroom-ready decisions in one workspace.
