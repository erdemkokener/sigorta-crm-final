# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
# Database file location
ENV DB_PATH=/data/policies.db

# Create a volume for persistent data
VOLUME ["/data"]

# Start the application
CMD ["npm", "start"]
