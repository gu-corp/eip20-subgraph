export $(grep -v '^#' .env | xargs)

if [ -z "${NETWORK_NAME}" ]
then
  echo NETWORK_NAME env is missing
  exit 1
fi

if [ -z "${START_BLOCK}" ]
then
  echo START_BLOCK env is missing
  exit 1
fi

if [ -z "${SUBGRAPH_NAME}" ]
then
  echo SUBGRAPH_NAME env is missing
  exit 1
fi

if [ -z "${GRAPH_NODE_URL}" ]
then
  echo GRAPH_NODE_URL env is missing
  exit 1
fi

if [ -z "${IPFS_URL}" ]
then
  echo IPFS_URL env is missing
  exit 1
fi

if [ -z "${VERSION}" ]
then
  VERSION="v1.0.0"
fi

# Generate subgraph.yaml from subgraph-template.yaml
sed "s/NETWORK_NAME/$NETWORK_NAME/g; s/START_BLOCK/$START_BLOCK/g" $1 subgraph-template.yaml > subgraph.yaml

graph codegen
graph build

graph remove $SUBGRAPH_NAME --node $GRAPH_NODE_URL
graph create $SUBGRAPH_NAME --node $GRAPH_NODE_URL
graph deploy $SUBGRAPH_NAME --node $GRAPH_NODE_URL --ipfs $IPFS_URL --version-label $VERSION