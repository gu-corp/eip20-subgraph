# EIP20 Subgraph

A comprehensive subgraph for indexing all ERC20 token balances, transfers, and approvals across multiple blockchain networks.

## Overview

This subgraph tracks ERC20 token events and maintains up-to-date balance information for all accounts. It provides a complete view of token transfers, balances, and contract metadata for any ERC20-compliant token.

## Features

- **Complete ERC20 Tracking**: Indexes all Transfer events from ERC20 contracts
- **Real-time Balance Updates**: Maintains current balance information for all accounts
- **Multi-Network Support**: Deployable on Ethereum mainnet, Sepolia testnet, and JOC networks
- **Comprehensive Data Model**: Tracks accounts, contracts, balances, and transfer events
- **Decimal Handling**: Properly handles tokens with different decimal places (up to 36 decimals)

## Data Schema

The subgraph tracks the following entities:

### Core Entities

- **Account**: Represents any Ethereum address that interacts with ERC20 tokens
- **ERC20Contract**: Represents ERC20 token contracts with metadata (name, symbol, decimals)
- **ERC20Balance**: Tracks token balances for accounts and total supply
- **ERC20Transfer**: Records all transfer events with detailed information
- **Transaction**: Links events to their originating transactions

### Key Relationships

- Each account can hold multiple ERC20 token balances
- Each ERC20 contract maintains a list of all balances and transfers
- Transfer events link sender and receiver balances
- All events are connected to their originating transactions

## Supported Networks

- **Ethereum Mainnet**: Production deployment
- **Sepolia Testnet**: Testing and development
- **JOC Network**: Custom blockchain network
- **JOC Testnet**: JOC network testing environment

## Installation

1. Clone the repository:
```bash
git clone https://github.com/gu-corp/eip20-subgraph.git
cd eip20-subgraph
```

2. Install dependencies:
```bash
npm install
```

3. Generate code from schema:
```bash
npm run codegen
```

4. Build the subgraph:
```bash
npm run build
```

## Deployment

### Prerequisites

- Graph CLI installed globally: `npm install -g @graphprotocol/graph-cli`
- Access to The Graph Studio or a local Graph Node
- Network-specific configuration

### Deploy to The Graph Studio

1. Authenticate with The Graph Studio:
```bash
npm run auth
```

2. Create a subgraph (if not already created):
```bash
npm run create
```

3. Deploy the subgraph:
```bash
npm run deploy
```

### Network-Specific Deployment

The subgraph can be deployed to different networks by modifying the `subgraph.yaml` file:

- Change the `network` field to your target network
- Update the `startBlock` if needed
- Ensure the network is supported in `networks.json`

## Usage

### Querying Token Information

```graphql
# Get all ERC20 contracts
{
  erc20Contracts {
    id
    name
    symbol
    decimals
    totalSupply {
      value
    }
  }
}
```

### Querying Account Balances

```graphql
# Get balances for a specific account
{
  account(id: "0x...") {
    erc20Balances {
      contract {
        name
        symbol
      }
      value
    }
  }
}
```

### Querying Transfer History

```graphql
# Get recent transfers
{
  erc20Transfers(
    orderBy: timestamp
    orderDirection: desc
    first: 100
  ) {
    id
    from {
      id
    }
    to {
      id
    }
    value
    contract {
      symbol
    }
    timestamp
  }
}
```

## Development

### Project Structure

```
├── src/
│   └── mapping.ts          # Event handlers and data processing
├── schema.graphql          # GraphQL schema definition
├── subgraph.yaml           # Subgraph configuration
├── networks.json           # Network-specific settings
└── package.json           # Dependencies and scripts
```

### Key Components

- **mapping.ts**: Contains the `handleTransfer` function that processes ERC20 Transfer events
- **schema.graphql**: Defines the data model and relationships
- **subgraph.yaml**: Configures the subgraph for specific networks and contracts

### Adding New Networks

1. Add network configuration to `networks.json`
2. Update `subgraph.yaml` with the new network
3. Deploy using the standard deployment process

## Configuration

### Environment Variables

- `GRAPH_ACCESS_TOKEN`: Required for deployment to The Graph Studio
- Network-specific RPC endpoints (configured in deployment environment)

### Customization

- **Start Block**: Modify `startBlock` in `subgraph.yaml` for different deployment points
- **Contract Filtering**: Add contract address filters if needed
- **Event Handlers**: Extend `mapping.ts` to handle additional ERC20 events

## Monitoring

The subgraph provides real-time indexing of ERC20 events. Monitor:

- Indexing progress in The Graph Studio
- Query performance and response times
- Error logs for failed event processing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Create an issue in the GitHub repository
- Check The Graph documentation for subgraph development
- Review the Graph Protocol Discord for community support

## Version History

- **v1.0.0**: Initial release with comprehensive ERC20 tracking
  - Multi-network support
  - Complete balance tracking
  - Transfer event indexing
  - Decimal handling for various token types
