import { gql } from "graphql-request";

export const LIST_BOUNTIES = gql`
  query ListBounties($first: Int!, $offset: Int!, $orderBy: [BountiesOrderBy!]) {
    allBounties(first: $first, offset: $offset, orderBy: $orderBy) {
      totalCount
      nodes {
        id
        poster
        reward
        track
        status
        withdrawn
        title
        postedAt
        deadline
        worker
        postTxHash
        claimTxHash
        submitTxHash
        acceptTxHash
        withdrawTxHash
        lastEventBlock
      }
    }
  }
`;

export const BOUNTY_BY_ID = gql`
  query BountyById($id: BigInt!) {
    bountyById(id: $id) {
      id
      poster
      reward
      track
      status
      withdrawn
      title
      description
      acceptance
      postedAt
      deadline
      worker
      resultHash
      postTxHash
      claimTxHash
      submitTxHash
      acceptTxHash
      withdrawTxHash
      lastEventBlock
    }
  }
`;

export const POSTER_BOUNTIES = gql`
  query PosterBounties($poster: String!) {
    allBounties(
      filter: { poster: { equalTo: $poster } }
      orderBy: POSTED_AT_DESC
    ) {
      totalCount
      nodes {
        id
        poster
        reward
        track
        status
        withdrawn
        title
        postedAt
        deadline
        worker
        postTxHash
        claimTxHash
        submitTxHash
        acceptTxHash
        withdrawTxHash
        lastEventBlock
      }
    }
  }
`;

export const WORKER_BOUNTIES = gql`
  query WorkerBounties($worker: String!) {
    allBounties(
      filter: { worker: { equalTo: $worker } }
      orderBy: POSTED_AT_DESC
    ) {
      totalCount
      nodes {
        id
        poster
        reward
        track
        status
        withdrawn
        title
        postedAt
        deadline
        worker
        postTxHash
        claimTxHash
        submitTxHash
        acceptTxHash
        withdrawTxHash
        lastEventBlock
      }
    }
  }
`;

export const STATS_TOTALS = gql`
  query StatsTotals {
    total:     allBounties { totalCount }
    open:      allBounties(filter: { status: { equalTo: "Open" } }) { totalCount }
    claimed:   allBounties(filter: { status: { equalTo: "Claimed" } }) { totalCount }
    submitted: allBounties(filter: { status: { equalTo: "Submitted" } }) { totalCount }
    accepted:  allBounties(filter: { status: { equalTo: "Accepted" }, withdrawn: { equalTo: false } }) { totalCount }
    withdrawn: allBounties(filter: { status: { equalTo: "Accepted" }, withdrawn: { equalTo: true } }) { totalCount }
    rejected:  allBounties(filter: { status: { equalTo: "Rejected" } }) { totalCount }
  }
`;

export const STATS_REWARDS = gql`
  query StatsRewards {
    allBounties {
      nodes {
        id
        reward
        status
        withdrawn
      }
    }
  }
`;

export const AGENT_DIRECTORY = gql`
  query AgentDirectory {
    allBountyEvents(
      filter: { eventName: { in: ["BountyClaimed", "BountySubmitted"] } }
      orderBy: BLOCK_NUMBER_DESC
    ) {
      nodes {
        eventName
        bountyId
        blockNumber
        txHash
        payload
      }
    }
    allBounties {
      totalCount
    }
  }
`;

export const BOUNTY_EVENTS = gql`
  query BountyEvents($bountyId: BigInt!) {
    allBountyEvents(
      filter: { bountyId: { equalTo: $bountyId } }
      orderBy: BLOCK_NUMBER_ASC
    ) {
      nodes {
        eventUid
        bountyId
        eventName
        blockNumber
        blockHash
        txHash
        payload
      }
    }
  }
`;
