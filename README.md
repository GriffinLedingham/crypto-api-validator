# crypto-nft-validator

A simple (hacked together) script to compare NFT activity API's for differences and varying event data over the last 2 hours (up to -5 minutes).

## Setup

- `yarn`
- `cp .env.sample .env`
- Fill in the `.env` file with your various API keys

## Usage

- `yarn start COLLECTION_ADDRESS` - Compares data for the provided collection address. ie. `0xed5af388653567af2f388e6224dc7c4b3241c544`
- `yarn bayc` - Compares data for the Bored Ape Yacht Club collection
- `yarn azuki` - Compares data for the Azuki collection
- `yarn otherdeed` - Compares data for the Otherdeed collection
- `yarn parallel` - Compares data for the Parallel Alpha collection
