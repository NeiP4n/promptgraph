# Architecture Overview

This document describes the system architecture. It covers the main components, data flow, and design decisions.

## Components

The system has three main components: the frontend, the backend API, and the database layer.

## Data Flow

Requests come through the API gateway, are validated by middleware, and then processed by the appropriate handler.

## Design Decisions

We chose PostgreSQL for its reliability and JSON support.
